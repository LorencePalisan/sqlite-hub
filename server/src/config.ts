import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const HUB_ROOT = process.env.HUB_ROOT ?? join(homedir(), "SQLiteHub");
export const DATABASES_DIR = join(HUB_ROOT, "databases");
export const BACKUPS_DIR = join(HUB_ROOT, "backups");
export const PORT = Number(process.env.PORT ?? 4517);
export const MAX_RESULT_ROWS = 5000;

const expandHome = (p: string) => p.replace(/^~(?=$|\/)/, homedir());

/** Folders searched for development databases. HUB_SCAN_ROOTS is a colon-separated list. */
export const SCAN_ROOTS = (process.env.HUB_SCAN_ROOTS ?? homedir())
  .split(":")
  .filter(Boolean)
  .map((p) => resolve(expandHome(p)));

export function ensureDirs() {
  mkdirSync(DATABASES_DIR, { recursive: true });
  mkdirSync(BACKUPS_DIR, { recursive: true });
}
