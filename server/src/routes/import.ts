import { Database } from "bun:sqlite";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { Hono } from "hono";
import { isSqliteFile } from "../registry";
import { dbPath, DB_NAME_RE, HttpError } from "../safety";

/**
 * Import an external database as a consistent snapshot via VACUUM INTO.
 * The source is opened read-only and never moved or modified.
 */
export function importDatabase(source: string, name?: string): string {
  const src = resolve(source.replace(/^~(?=$|\/)/, homedir()));
  if (!existsSync(src) || !statSync(src).isFile()) throw new HttpError(404, `File not found: ${src}`);
  if (!isSqliteFile(src)) throw new HttpError(400, `Not a SQLite database: ${src}`);

  let file = (name?.trim() || basename(src)).replace(/[^\w.-]/g, "_");
  if (!DB_NAME_RE.test(file)) file = `${file.replace(/\.[^.]*$/, "")}.sqlite`;
  const target = dbPath(file);
  if (existsSync(target)) throw new HttpError(409, `${file} already exists in the hub`);

  const db = new Database(src, { readonly: true });
  try {
    db.run("PRAGMA busy_timeout = 5000");
    db.run("VACUUM INTO ?", [target]);
  } finally {
    db.close();
  }
  return file;
}

export const importRoute = new Hono().post("/", async (c) => {
  const { path, name } = await c.req.json<{ path: string; name?: string }>();
  if (!path) throw new HttpError(400, "path is required");
  return c.json({ name: importDatabase(path, name) }, 201);
});
