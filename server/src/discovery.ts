import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { HUB_ROOT, SCAN_ROOTS } from "./config";
import { isSqliteFile } from "./registry";
import { HttpError } from "./safety";

/** A SQLite file found inside a development project somewhere under SCAN_ROOTS. */
export interface DevDb {
  name: string; // stable id ("dev-<hash>") used in API routes in place of a hub file name
  label: string;
  path: string;
  project: string;
  projectDir: string;
  kind: "d1" | "file";
  size: number;
  mtime: number;
}

export interface DevScan {
  scannedAt: number;
  ms: number;
  roots: string[];
  databases: DevDb[];
}

export const DEV_ID_RE = /^dev-[0-9a-f]{12}$/;

const EXT_RE = /\.(sqlite3?|db3?|s3db|sl3)$/i;
const MAX_DEPTH = 10;
const STALE_MS = 60_000;
// Big trees that never hold a project's own database (or belong to macOS apps).
const SKIP_DIRS = new Set([
  "node_modules",
  "Library",
  "Applications",
  "Music",
  "Movies",
  "Pictures",
  "vendor",
  "Pods",
  "DerivedData",
  "target",
  "__pycache__",
  "venv",
]);
const PROJECT_MARKERS = [
  "package.json",
  "wrangler.toml",
  "wrangler.json",
  "wrangler.jsonc",
  "composer.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "Gemfile",
  ".git",
];
const WRANGLER_CONFIGS = ["wrangler.toml", "wrangler.json", "wrangler.jsonc"];
const WRANGLER_SEG = `${sep}.wrangler${sep}`;

/** Caps concurrent readdir calls so a big home folder doesn't exhaust file descriptors. */
function limiter(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((r) => waiting.push(r));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

async function findCandidates(roots: string[]): Promise<string[]> {
  const limit = limiter(32);
  const found: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    const entries = await limit(() => readdir(dir, { withFileTypes: true })).catch(() => []);
    await Promise.all(
      entries.map((e) => {
        const full = join(dir, e.name);
        // Dirent.isDirectory() is false for symlinks, so links are never followed.
        if (e.isDirectory()) {
          const hidden = e.name.startsWith(".") && e.name !== ".wrangler";
          if (depth >= MAX_DEPTH || hidden || SKIP_DIRS.has(e.name) || e.name.endsWith(".app") || full === HUB_ROOT) {
            return;
          }
          return walk(full, depth + 1);
        }
        if (e.isFile() && EXT_RE.test(e.name)) found.push(full);
      }),
    );
  };
  await Promise.all(roots.filter((r) => existsSync(r)).map((r) => walk(r, 0)));
  return found;
}

/** Wrangler keeps KV/R2/cache/DO state in SQLite too; only D1 files are app databases. */
function isWranglerNoise(path: string): boolean {
  if (!path.includes(WRANGLER_SEG)) return false;
  return !path.includes(`${sep}d1${sep}`) || basename(path) === "metadata.sqlite";
}

function findProjectDir(path: string, roots: string[], markerCache: Map<string, boolean>): string {
  const w = path.indexOf(WRANGLER_SEG);
  if (w !== -1) return path.slice(0, w);
  let dir = dirname(path);
  while (!roots.includes(dir) && dirname(dir) !== dir) {
    let hit = markerCache.get(dir);
    if (hit === undefined) {
      hit = PROJECT_MARKERS.some((m) => existsSync(join(dir, m)));
      markerCache.set(dir, hit);
    }
    if (hit) return dir;
    dir = dirname(dir);
  }
  return dirname(path);
}

function d1Names(projectDir: string): string[] {
  const names = new Set<string>();
  for (const f of WRANGLER_CONFIGS) {
    try {
      const text = readFileSync(join(projectDir, f), "utf8");
      for (const m of text.matchAll(/database_name"?\s*[=:]\s*"([^"]+)"/g)) names.add(m[1]);
    } catch {
      // No such config.
    }
  }
  return [...names];
}

async function scan(): Promise<DevScan> {
  const started = performance.now();
  const markerCache = new Map<string, boolean>();
  const candidates = (await findCandidates(SCAN_ROOTS)).filter((p) => !isWranglerNoise(p));

  const dbs: DevDb[] = [];
  for (const path of candidates) {
    let st;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    if (!isSqliteFile(path)) continue;
    const projectDir = findProjectDir(path, SCAN_ROOTS, markerCache);
    const kind = path.includes(WRANGLER_SEG) ? "d1" : "file";
    dbs.push({
      name: devId(path),
      label: kind === "d1" ? `D1 ${basename(path).slice(0, 8)}` : relative(projectDir, path),
      path,
      project: basename(projectDir),
      projectDir,
      kind,
      size: st.size,
      mtime: st.mtimeMs,
    });
  }

  // Miniflare names D1 files by a hash, so use the configured name when it's unambiguous.
  const byProject = Map.groupBy(
    dbs.filter((d) => d.kind === "d1"),
    (d) => d.projectDir,
  );
  for (const [dir, files] of byProject) {
    const names = d1Names(dir);
    if (names.length === 1 && files.length === 1) files[0].label = names[0];
  }

  dbs.sort((a, b) => a.projectDir.localeCompare(b.projectDir) || a.label.localeCompare(b.label));
  return { scannedAt: Date.now(), ms: Math.round(performance.now() - started), roots: SCAN_ROOTS, databases: dbs };
}

export function devId(path: string): string {
  return `dev-${createHash("sha1").update(path).digest("hex").slice(0, 12)}`;
}

let cache: DevScan | null = null;
let inflight: Promise<DevScan> | null = null;

/**
 * Returns the last scan, rescanning when forced or when it's older than a minute.
 * A stale result is returned immediately while a fresh scan runs in the background.
 */
export async function discover(force = false): Promise<DevScan> {
  const fresh = cache && Date.now() - cache.scannedAt < STALE_MS;
  if (!force && fresh) return cache!;
  inflight ??= scan()
    .then((r) => (cache = r))
    .finally(() => (inflight = null));
  return !force && cache ? cache : inflight;
}

export function findDevDb(id: string): DevDb | undefined {
  return cache?.databases.find((d) => d.name === id);
}

/** Only paths the scanner found are reachable, so ids can't be used to open arbitrary files. */
export function devDbPath(id: string): string {
  const db = findDevDb(id);
  if (!db) throw new HttpError(404, `Database not found: ${id}`);
  return db.path;
}
