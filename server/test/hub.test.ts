import { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "sqlite-hub-test-"));
process.env.HUB_ROOT = root;
const scanRoot = mkdtempSync(join(tmpdir(), "sqlite-hub-scan-"));
process.env.HUB_SCAN_ROOTS = scanRoot;

// Dynamic imports so config picks up HUB_ROOT.
const { app } = await import("../src/index");
const { DATABASES_DIR, BACKUPS_DIR } = await import("../src/config");
const { destructiveReason, splitStatements, dbPath } = await import("../src/safety");
const { scanDatabases } = await import("../src/registry");

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(scanRoot, { recursive: true, force: true });
});

function makeDb(path: string, rows = 250) {
  const db = new Database(path, { create: true });
  db.run("CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT, data BLOB)");
  const ins = db.prepare("INSERT INTO items (label, data) VALUES (?, ?)");
  db.transaction(() => {
    for (let i = 1; i <= rows; i++) ins.run(`item ${i}`, i % 10 === 0 ? new Uint8Array(8) : null);
  })();
  db.close();
}

const call = (path: string, init?: RequestInit) =>
  app.request(path, { ...init, headers: init?.body ? { "Content-Type": "application/json" } : undefined });

makeDb(join(DATABASES_DIR, "main.sqlite"));
writeFileSync(join(DATABASES_DIR, "notes.db"), "this is not sqlite at all");
writeFileSync(join(DATABASES_DIR, "readme.txt"), "hello");

describe("registry", () => {
  test("lists only real SQLite files with supported extensions", () => {
    expect(scanDatabases().map((d) => d.name)).toEqual(["main.sqlite"]);
  });
});

describe("safety", () => {
  test("rejects path traversal and odd names", () => {
    for (const bad of ["../x.sqlite", "a/b.sqlite", "..sqlite", ".hidden.db", "x.txt", "/etc/passwd"]) {
      expect(() => dbPath(bad)).toThrow();
    }
    expect(dbPath("ok-name_1.sqlite3")).toBe(join(DATABASES_DIR, "ok-name_1.sqlite3"));
  });

  test("traversal via the API is a 400", async () => {
    const res = await call(`/api/databases/${encodeURIComponent("../main.sqlite")}`);
    expect(res.status).toBe(400);
  });

  test("destructive detection", () => {
    expect(destructiveReason("DROP TABLE x")).toBe("DROP statement");
    expect(destructiveReason("delete from items")).toBe("DELETE without WHERE");
    expect(destructiveReason("DELETE FROM items WHERE id = 1")).toBeNull();
    expect(destructiveReason("UPDATE items SET label = 'x'")).toBe("UPDATE without WHERE");
    expect(destructiveReason("UPDATE items SET label = 'where' -- WHERE")).toBe("UPDATE without WHERE");
    expect(destructiveReason("SELECT 'drop table x'")).toBeNull();
    expect(destructiveReason("PRAGMA journal_mode = WAL")).toBe("PRAGMA assignment");
    expect(destructiveReason("PRAGMA table_info(items)")).toBeNull();
  });

  test("statement splitting respects strings, comments and triggers", () => {
    expect(splitStatements("select 1; select ';' ; -- c;\nselect 2;")).toHaveLength(3);
    const trig = `CREATE TRIGGER t AFTER INSERT ON items BEGIN UPDATE items SET label = 'x'; DELETE FROM items WHERE 0; END; SELECT 1`;
    expect(splitStatements(trig)).toHaveLength(2);
  });
});

describe("browse API", () => {
  test("database detail", async () => {
    const body = await (await call("/api/databases/main.sqlite")).json();
    expect(body.objects).toEqual([{ name: "items", type: "table", rowCount: 250 }]);
  });

  test("pagination and sorting", async () => {
    const res = await call("/api/databases/main.sqlite/tables/items/rows?limit=100&offset=200&orderBy=id&dir=desc");
    const body = await res.json();
    expect(body.total).toBe(250);
    expect(body.rows).toHaveLength(50);
    expect(body.rows[0][0]).toBe(50);
    expect(body.columns).toEqual(["id", "label", "data"]);
  });

  test("blobs are placeholders", async () => {
    const body = await (await call("/api/databases/main.sqlite/tables/items/rows?limit=10")).json();
    expect(body.rows[9][2]).toEqual({ $blob: 8 });
  });

  test("unknown sort column is rejected", async () => {
    const res = await call("/api/databases/main.sqlite/tables/items/rows?orderBy=nope");
    expect(res.status).toBe(400);
  });

  test("schema", async () => {
    const body = await (await call("/api/databases/main.sqlite/tables/items/schema")).json();
    expect(body.columns.map((c: { name: string }) => c.name)).toEqual(["id", "label", "data"]);
  });
});

describe("query API", () => {
  const q = (sql: string, confirm = false) =>
    call("/api/databases/main.sqlite/query", { method: "POST", body: JSON.stringify({ sql, confirm }) });

  test("select returns results, duplicate column names survive", async () => {
    const body = await (await q("SELECT a.id, b.id FROM items a JOIN items b ON a.id = b.id LIMIT 3")).json();
    expect(body.results[0].columns).toEqual(["id", "id"]);
    expect(body.results[0].rows[2]).toEqual([3, 3]);
  });

  test("results cap at 5000 rows", async () => {
    const body = await (
      await q("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 6000) SELECT i FROM n")
    ).json();
    expect(body.results[0].rows).toHaveLength(5000);
    expect(body.results[0].truncated).toBe(true);
  });

  test("SQL errors are 400s", async () => {
    const res = await q("SELEC nope");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("syntax");
  });

  test("failed script rolls back", async () => {
    await q("INSERT INTO items (label) VALUES ('rolled back'); SELECT * FROM missing_table");
    const body = await (await q("SELECT COUNT(*) FROM items WHERE label = 'rolled back'")).json();
    expect(body.results[0].rows[0][0]).toBe(0);
  });

  test("destructive needs confirm, then backs up and runs", async () => {
    const res = await q("DELETE FROM items");
    expect(res.status).toBe(409);
    expect((await res.json()).reasons).toEqual(["DELETE without WHERE"]);

    const ok = await (await q("DELETE FROM items", true)).json();
    expect(ok.results[0].changes).toBe(250);
    expect(ok.backup).toMatch(/^main-.*\.sqlite$/);

    const backup = new Database(join(BACKUPS_DIR, ok.backup), { readonly: true });
    expect(backup.query("SELECT COUNT(*) AS n FROM items").get()).toEqual({ n: 250 });
    backup.close();
  });
});

describe("import", () => {
  test("snapshots an external DB without modifying it", async () => {
    const ext = mkdtempSync(join(tmpdir(), "sqlite-hub-ext-"));
    const src = join(ext, "outside.db");
    makeDb(src, 42);
    const before = readFileSync(src);

    const res = await call("/api/import", { method: "POST", body: JSON.stringify({ path: src }) });
    expect(res.status).toBe(201);
    expect((await res.json()).name).toBe("outside.db");

    expect(readFileSync(src).equals(before)).toBe(true);
    expect(readdirSync(ext)).toEqual(["outside.db"]);
    const copy = new Database(join(DATABASES_DIR, "outside.db"), { readonly: true });
    expect(copy.query("SELECT COUNT(*) AS n FROM items").get()).toEqual({ n: 42 });
    copy.close();

    const again = await call("/api/import", { method: "POST", body: JSON.stringify({ path: src }) });
    expect(again.status).toBe(409);
    rmSync(ext, { recursive: true, force: true });
  });

  test("rejects non-SQLite files", async () => {
    const res = await call("/api/import", {
      method: "POST",
      body: JSON.stringify({ path: join(DATABASES_DIR, "readme.txt") }),
    });
    expect(res.status).toBe(400);
  });
});

describe("discovery", () => {
  const put = (rel: string, rows = 3) => {
    const full = join(scanRoot, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    makeDb(full, rows);
    return full;
  };

  test("finds project databases and Wrangler D1 files, skipping noise", async () => {
    mkdirSync(join(scanRoot, "app"), { recursive: true });
    writeFileSync(join(scanRoot, "app/package.json"), "{}");
    put("app/prisma/dev.db");
    put("app/node_modules/pkg/cache.sqlite");
    put("app/.hidden/state.sqlite");

    const d1 = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
    mkdirSync(join(scanRoot, "worker"), { recursive: true });
    writeFileSync(join(scanRoot, "worker/wrangler.jsonc"), `{ "d1_databases": [{ "database_name": "shop-db" }] }`);
    put(`worker/${d1}/abc123def456.sqlite`, 7);
    put(`worker/${d1}/metadata.sqlite`);
    put("worker/.wrangler/state/v3/kv/miniflare-KVNamespaceObject/kv.sqlite");

    const body = await (await call("/api/discovered?refresh=1")).json();
    const found = body.databases.map((d: { project: string; label: string; kind: string }) => [d.project, d.label, d.kind]);
    expect(found).toEqual([
      ["app", join("prisma", "dev.db"), "file"],
      ["worker", "shop-db", "d1"],
    ]);
  });

  test("discovered databases are browsable and queryable by id", async () => {
    const { databases: dbs } = await (await call("/api/discovered")).json();
    const worker = dbs.find((d: { project: string }) => d.project === "worker");
    expect(worker.name).toMatch(/^dev-[0-9a-f]{12}$/);

    const detail = await (await call(`/api/databases/${worker.name}`)).json();
    expect(detail.objects).toEqual([{ name: "items", type: "table", rowCount: 7 }]);

    const res = await call(`/api/databases/${worker.name}/query`, {
      method: "POST",
      body: JSON.stringify({ sql: "DELETE FROM items", confirm: true }),
    });
    expect((await res.json()).backup).toMatch(/^worker-shop-db-.*\.sqlite$/);
  });

  test("unknown dev ids are 404s", async () => {
    expect((await call("/api/databases/dev-000000000000")).status).toBe(404);
  });
});

describe("relations", () => {
  test("declared foreign keys, guessed links, and hidden FTS shadow tables", async () => {
    const db = new Database(join(DATABASES_DIR, "rel.sqlite"), { create: true });
    db.run(`CREATE TABLE users (id INTEGER PRIMARY KEY, account_id TEXT);
      CREATE TABLE categories (id INTEGER PRIMARY KEY);
      CREATE TABLE posts (id INTEGER PRIMARY KEY, author INTEGER REFERENCES users, user_id INTEGER, category_id INTEGER);
      CREATE VIRTUAL TABLE posts_fts USING fts5(body);`);
    db.close();

    const body = await (await call("/api/databases/rel.sqlite/relations")).json();
    expect(body.tables.map((t: { name: string }) => t.name)).toEqual(["categories", "posts", "posts_fts", "users"]);
    const rels = body.relations.map((r: { from: { column: string }; to: { table: string; column: string }; inferred: boolean }) =>
      `${r.from.column}->${r.to.table}.${r.to.column}${r.inferred ? "?" : ""}`,
    );
    expect(rels.sort()).toEqual(["author->users.id", "category_id->categories.id?", "user_id->users.id?"]);
  });
});
