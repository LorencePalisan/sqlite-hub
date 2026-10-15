import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { MAX_RESULT_ROWS } from "../config";
import { snapshot, withDb } from "../connections";
import { destructiveReason, HttpError, splitStatements } from "../safety";
import { serializeRow, type Cell } from "../serialize";

export interface StatementResult {
  sql: string;
  columns: string[];
  rows: Cell[][];
  truncated: boolean;
  changes: number;
}

// These can't run inside a transaction, or manage transactions themselves.
const NO_TX_RE = /^\s*(VACUUM|ATTACH|DETACH|BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i;

export function runScript(db: Database, statements: string[]): StatementResult[] {
  const runOne = (sql: string): StatementResult => {
    const stmt = db.prepare(sql);
    try {
      if (stmt.columnNames.length === 0) {
        const { changes } = stmt.run();
        return { sql, columns: [], rows: [], truncated: false, changes };
      }
      const columns = stmt.columnNames;
      // Duplicate column names (e.g. a.id, b.id) collapse in row objects, so fall
      // back to values(), which buffers the whole result. Otherwise stream and stop at the cap.
      if (new Set(columns).size !== columns.length) {
        const all = stmt.values();
        return {
          sql,
          columns,
          rows: all.slice(0, MAX_RESULT_ROWS).map(serializeRow),
          truncated: all.length > MAX_RESULT_ROWS,
          changes: 0,
        };
      }
      const rows: Cell[][] = [];
      let truncated = false;
      for (const row of stmt.iterate() as Iterable<Record<string, unknown>>) {
        if (rows.length >= MAX_RESULT_ROWS) {
          truncated = true;
          break;
        }
        rows.push(serializeRow(columns.map((col) => row[col])));
      }
      return { sql, columns, rows, truncated, changes: 0 };
    } finally {
      stmt.finalize();
    }
  };

  if (statements.some((s) => NO_TX_RE.test(s))) return statements.map(runOne);
  return db.transaction(() => statements.map(runOne))();
}

export const query = new Hono().post("/:db/query", async (c) => {
  const name = c.req.param("db");
  const { sql, confirm } = await c.req.json<{ sql: string; confirm?: boolean }>();
  const statements = splitStatements(sql ?? "");
  if (statements.length === 0) throw new HttpError(400, "No SQL to run");

  const reasons = statements.map(destructiveReason).filter((r): r is string => r !== null);
  if (reasons.length > 0 && !confirm) {
    return c.json({ error: "needs_confirm", reasons: [...new Set(reasons)] }, 409);
  }
  const backup = reasons.length > 0 ? snapshot(name) : null;

  const started = performance.now();
  const results = withDb(name, "rw", (db) => runScript(db, statements));
  return c.json({ results, backup, ms: Math.round((performance.now() - started) * 10) / 10 });
});
