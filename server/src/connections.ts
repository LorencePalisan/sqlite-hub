import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { BACKUPS_DIR } from "./config";
import { dbPath, HttpError } from "./safety";
import { DEV_ID_RE, devDbPath, findDevDb } from "./discovery";
import { isSqliteFile } from "./registry";

/** Hub databases are addressed by file name, discovered dev databases by their "dev-…" id. */
export function resolveDbPath(name: string): string {
  return DEV_ID_RE.test(name) ? devDbPath(name) : dbPath(name);
}

/**
 * Opens a short-lived connection per request. SQLite opens are cheap, and this
 * avoids holding file handles on databases the user may move or delete in Finder.
 */
export function withDb<T>(name: string, mode: "ro" | "rw", fn: (db: Database) => T): T {
  const path = resolveDbPath(name);
  if (!existsSync(path) || !isSqliteFile(path)) {
    throw new HttpError(404, `Database not found: ${name}`);
  }
  const db = new Database(path, mode === "ro" ? { readonly: true } : { readwrite: true, strict: true });
  try {
    db.run("PRAGMA busy_timeout = 5000");
    if (mode === "rw") db.run("PRAGMA foreign_keys = ON");
    return fn(db);
  } finally {
    db.close();
  }
}

/** Local-time timestamp safe for filenames, e.g. 2026-10-15_18-37-42-219. */
export function timestamp(d = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_` +
    `${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`
  );
}

/** Take a consistent snapshot of a database into backups/. Returns the backup file name. */
export function snapshot(name: string): string {
  const dev = findDevDb(name);
  const base = dev
    ? `${dev.project}-${dev.label}`.replace(/\.[^.]*$/, "").replace(/[^\w.-]/g, "_")
    : name.replace(/\.(sqlite3?|db)$/, "");
  const file = `${base}-${timestamp()}.sqlite`;
  const target = join(BACKUPS_DIR, file);
  withDb(name, "ro", (db) => db.run("VACUUM INTO ?", [target]));
  return file;
}
