export type Cell = string | number | null | { $blob: number };

export interface DbFile {
  name: string;
  size: number;
  mtime: number;
  tableCount?: number | null;
  // Set on databases discovered in dev projects; `name` is then an opaque "dev-…" id.
  label?: string;
  path?: string;
  project?: string;
  projectDir?: string;
  kind?: "d1" | "file";
}

export interface DevScan {
  scannedAt: number;
  ms: number;
  roots: string[];
  databases: DbFile[];
}

export const dbTitle = (d: DbFile) => (d.label ? `${d.project} · ${d.label}` : d.name);

export interface DbObject {
  name: string;
  type: "table" | "view";
  rowCount: number | null;
}

export interface DbDetail {
  name: string;
  objects: DbObject[];
  journalMode: string;
  pageSize: number;
  pageCount: number;
  sqliteVersion: string;
}

export interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
  hidden: number;
}

export interface TableSchema {
  name: string;
  type: "table" | "view";
  sql: string | null;
  columns: ColumnInfo[];
  indexes: { name: string; unique: number; origin: string; partial: number }[];
  foreignKeys: { id: number; table: string; from: string; to: string; on_update: string; on_delete: string }[];
}

export interface RowsPage {
  columns: string[];
  rows: Cell[][];
  total: number;
  limit: number;
  offset: number;
}

export interface RelTable {
  name: string;
  columns: { name: string; type: string; pk: boolean; notnull: boolean }[];
  rowCount: number | null;
}

export interface Relation {
  from: { table: string; column: string };
  to: { table: string; column: string };
  inferred: boolean;
}

export interface Relations {
  tables: RelTable[];
  relations: Relation[];
}

export interface StatementResult {
  sql: string;
  columns: string[];
  rows: Cell[][];
  truncated: boolean;
  changes: number;
}

export interface QueryResponse {
  results: StatementResult[];
  backup: string | null;
  ms: number;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: { error: string; reasons?: string[] },
  ) {
    super(body.error);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const body = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

const enc = encodeURIComponent;

export const api = {
  listDatabases: () => req<DbFile[]>("/databases"),
  discovered: (refresh = false) => req<DevScan>(`/discovered${refresh ? "?refresh=1" : ""}`),
  createDatabase: (name: string) => req<{ name: string }>("/databases", { method: "POST", body: JSON.stringify({ name }) }),
  database: (db: string) => req<DbDetail>(`/databases/${enc(db)}`),
  schema: (db: string, table: string) => req<TableSchema>(`/databases/${enc(db)}/tables/${enc(table)}/schema`),
  rows: (db: string, table: string, p: { limit: number; offset: number; orderBy?: string; dir?: "asc" | "desc" }) => {
    const q = new URLSearchParams({ limit: String(p.limit), offset: String(p.offset) });
    if (p.orderBy) q.set("orderBy", p.orderBy);
    if (p.dir) q.set("dir", p.dir);
    return req<RowsPage>(`/databases/${enc(db)}/tables/${enc(table)}/rows?${q}`);
  },
  relations: (db: string) => req<Relations>(`/databases/${enc(db)}/relations`),
  query: (db: string, sql: string, confirm = false) =>
    req<QueryResponse>(`/databases/${enc(db)}/query`, { method: "POST", body: JSON.stringify({ sql, confirm }) }),
  backup: (db: string) => req<{ backup: string }>(`/databases/${enc(db)}/backup`, { method: "POST" }),
  importDb: (path: string, name?: string) =>
    req<{ name: string }>("/import", { method: "POST", body: JSON.stringify({ path, name: name || undefined }) }),
};

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}
