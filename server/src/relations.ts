import { Database } from "bun:sqlite";
import { quoteIdent } from "./safety";

export interface RelColumn {
  name: string;
  type: string;
  pk: boolean;
  notnull: boolean;
}

export interface RelTable {
  name: string;
  columns: RelColumn[];
  rowCount: number | null;
}

export interface Relation {
  from: { table: string; column: string };
  to: { table: string; column: string };
  /** Guessed from a `<table>_id` / `<table>Id` column name rather than a declared FOREIGN KEY. */
  inferred: boolean;
}

// fts5/fts4/rtree create these backing tables next to the virtual table.
const SHADOW_SUFFIX_RE = /_(data|idx|content|docsize|config|segments|segdir|stat|node|parent|rowid)$/;

/** Tables, their columns, and the relationships between them, for the diagram view. */
export function readRelations(db: Database): { tables: RelTable[]; relations: Relation[] } {
  const objects = db
    .query<{ name: string; sql: string | null }, []>(
      "SELECT name, sql FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
    )
    .all();
  const virtuals = objects.filter((o) => /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(o.sql ?? "")).map((o) => o.name);
  const isShadow = (name: string) =>
    virtuals.some((v) => name !== v && name.startsWith(`${v}_`) && SHADOW_SUFFIX_RE.test(name));

  const tables: RelTable[] = objects
    .filter((o) => !isShadow(o.name))
    .map((o) => {
      const q = quoteIdent(o.name);
      const columns = db
        .query<{ name: string; type: string; pk: number; notnull: number }, []>(`PRAGMA table_info(${q})`)
        .all()
        .map((c) => ({ name: c.name, type: c.type, pk: c.pk > 0, notnull: c.notnull === 1 }));
      let rowCount: number | null = null;
      try {
        rowCount = db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${q}`).get()!.n;
      } catch {
        // Virtual tables whose module isn't loaded can't be counted.
      }
      return { name: o.name, columns, rowCount };
    });

  const byLower = new Map(tables.map((t) => [t.name.toLowerCase(), t]));
  const pkOf = (t: RelTable) => {
    const pks = t.columns.filter((c) => c.pk);
    if (pks.length === 1) return pks[0].name;
    return t.columns.find((c) => c.name.toLowerCase() === "id")?.name ?? null;
  };

  const relations: Relation[] = [];
  for (const t of tables) {
    const declared = new Set<string>();
    const fks = db
      .query<{ table: string; from: string; to: string | null }, []>(`PRAGMA foreign_key_list(${quoteIdent(t.name)})`)
      .all();
    for (const fk of fks) {
      const target = byLower.get(fk.table.toLowerCase());
      // `to` is null when the FK references the parent's primary key implicitly.
      const column = fk.to ?? (target && pkOf(target));
      if (!target || !column) continue;
      declared.add(fk.from);
      relations.push({ from: { table: t.name, column: fk.from }, to: { table: target.name, column }, inferred: false });
    }

    for (const col of t.columns) {
      if (declared.has(col.name)) continue;
      const m = /^(.+?)(?:_id|Id|ID)$/.exec(col.name);
      if (!m) continue;
      const base = m[1].toLowerCase();
      const candidates = [base, `${base}s`, `${base}es`, base.replace(/y$/, "ies")];
      const target = candidates.map((n) => byLower.get(n)).find((x) => x !== undefined);
      const column = target && pkOf(target);
      // A table's own `<table>_id` is almost always an external id (e.g. an OAuth account id), not a self-reference.
      if (!target || !column || target === t) continue;
      relations.push({ from: { table: t.name, column: col.name }, to: { table: target.name, column }, inferred: true });
    }
  }
  return { tables, relations };
}
