import { openSync, readSync, closeSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DATABASES_DIR } from "./config";
import { DB_NAME_RE } from "./safety";

const HEADER = "SQLite format 3\0";

export interface DbFileInfo {
  name: string;
  size: number;
  mtime: number;
}

export function isSqliteFile(path: string): boolean {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const buf = Buffer.alloc(16);
    const n = readSync(fd, buf, 0, 16, 0);
    // A zero-length file is a valid (empty) SQLite database.
    if (n === 0) return true;
    return n === 16 && buf.toString("latin1") === HEADER;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function scanDatabases(dir = DATABASES_DIR): DbFileInfo[] {
  const out: DbFileInfo[] = [];
  for (const name of readdirSync(dir)) {
    if (!DB_NAME_RE.test(name) || name.startsWith(".")) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (!st.isFile() || !isSqliteFile(full)) continue;
    out.push({ name, size: st.size, mtime: st.mtimeMs });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
