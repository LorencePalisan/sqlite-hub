import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { Hono } from "hono";
import { scanDatabases } from "../registry";
import { snapshot, withDb } from "../connections";
import { dbPath, DB_NAME_RE, HttpError, quoteIdent } from "../safety";
import { serializeRow } from "../serialize";
import { readRelations } from "../relations";

interface SchemaObject {
  name: string;
  type: "table" | "view";
  sql: string | null;
}

function listObjects(db: Database): SchemaObject[] {
  return db
    .query<SchemaObject, []>(
      "SELECT name, type, sql FROM sqlite_schema WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
    )
    .all();
}

function requireObject(db: Database, table: string): SchemaObject {
  const obj = listObjects(db).find((o) => o.name === table);
  if (!obj) throw new HttpError(404, `Table not found: ${table}`);
  return obj;
}

export const databases = new Hono()
  .get("/", (c) => {
    const files = scanDatabases().map((f) => {
      let tableCount: number | null = null;
      try {
        tableCount = withDb(f.name, "ro", (db) => listObjects(db).filter((o) => o.type === "table").length);
      } catch {
        // Unreadable/locked/corrupt: still list it, without a count.
      }
      return { ...f, tableCount };
    });
    return c.json(files);
  })

  .post("/", async (c) => {
    const { name } = await c.req.json<{ name: string }>();
    const file = DB_NAME_RE.test(name) ? name : `${name}.sqlite`;
    const path = dbPath(file);
    if (existsSync(path)) throw new HttpError(409, `${file} already exists`);
    new Database(path, { create: true }).close();
    return c.json({ name: file }, 201);
  })

  .get("/:db", (c) => {
    const name = c.req.param("db");
    return c.json(
      withDb(name, "ro", (db) => {
        const objects = listObjects(db).map((o) => {
          let rowCount: number | null = null;
          if (o.type === "table") {
            try {
              rowCount = db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${quoteIdent(o.name)}`).get()!.n;
            } catch {
              // Virtual tables whose module isn't loaded can't be counted.
            }
          }
          return { name: o.name, type: o.type, rowCount };
        });
        const pragma = (p: string) => (db.query(`PRAGMA ${p}`).values()[0]?.[0] ?? null) as string | number | null;
        return {
          name,
          objects,
          journalMode: pragma("journal_mode"),
          pageSize: pragma("page_size"),
          pageCount: pragma("page_count"),
          sqliteVersion: db.query("SELECT sqlite_version()").values()[0][0],
        };
      }),
    );
  })

  .get("/:db/tables/:table/schema", (c) => {
    const { db: name, table } = c.req.param();
    return c.json(
      withDb(name, "ro", (db) => {
        const obj = requireObject(db, table);
        const q = quoteIdent(table);
        return {
          name: obj.name,
          type: obj.type,
          sql: obj.sql,
          columns: db.query(`PRAGMA table_xinfo(${q})`).all(),
          indexes: db.query(`PRAGMA index_list(${q})`).all(),
          foreignKeys: db.query(`PRAGMA foreign_key_list(${q})`).all(),
        };
      }),
    );
  })

  .get("/:db/tables/:table/rows", (c) => {
    const { db: name, table } = c.req.param();
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 100) || 100, 1), 1000);
    const offset = Math.max(Number(c.req.query("offset") ?? 0) || 0, 0);
    const orderBy = c.req.query("orderBy");
    const dir = c.req.query("dir") === "desc" ? "DESC" : "ASC";

    return c.json(
      withDb(name, "ro", (db) => {
        requireObject(db, table);
        const q = quoteIdent(table);
        const cols = db.query<{ name: string }, []>(`PRAGMA table_xinfo(${q})`).all().map((r) => r.name);
        if (orderBy && !cols.includes(orderBy)) throw new HttpError(400, `Unknown column: ${orderBy}`);
        const order = orderBy ? ` ORDER BY ${quoteIdent(orderBy)} ${dir}` : "";
        const stmt = db.query(`SELECT * FROM ${q}${order} LIMIT ? OFFSET ?`);
        const rows = stmt.values(limit, offset).map(serializeRow);
        const total = db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${q}`).get()!.n;
        return { columns: stmt.columnNames, rows, total, limit, offset };
      }),
    );
  })

  .get("/:db/relations", (c) => c.json(withDb(c.req.param("db"), "ro", readRelations)))

  .post("/:db/backup", (c) => c.json({ backup: snapshot(c.req.param("db")) }, 201));
