import { resolve, sep } from "node:path";
import { DATABASES_DIR } from "./config";

export const DB_NAME_RE = /^[\w.-]+\.(sqlite|sqlite3|db)$/;

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

/** Resolve a database name to an absolute path inside DATABASES_DIR, or throw. */
export function dbPath(name: string): string {
  if (!DB_NAME_RE.test(name) || name.startsWith(".")) {
    throw new HttpError(400, `Invalid database name: ${name}`);
  }
  const full = resolve(DATABASES_DIR, name);
  if (!full.startsWith(DATABASES_DIR + sep)) {
    throw new HttpError(400, `Invalid database name: ${name}`);
  }
  return full;
}

export function quoteIdent(id: string): string {
  return `"${id.replaceAll('"', '""')}"`;
}

/** Remove comments and string/identifier literals so keyword checks don't trip on their contents. */
function stripLiterals(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/`[^`]*`/g, "``")
    .replace(/\[[^\]]*\]/g, "[]");
}

/** Split a script into individual statements on top-level semicolons. */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const two = sql.slice(i, i + 2);
    if (two === "--") {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? sql.length : end;
      cur += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (two === "/*") {
      const end = sql.indexOf("*/", i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      cur += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) j += 2;
          else break;
        } else j++;
      }
      cur += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === "[") {
      const end = sql.indexOf("]", i);
      const stop = end === -1 ? sql.length : end + 1;
      cur += sql.slice(i, stop);
      i = stop;
      continue;
    }
    // Triggers contain semicolons inside BEGIN ... END; keep them together.
    if (ch === ";" && !/\bCREATE\s+(TEMP\w*\s+)?TRIGGER\b[\s\S]*\bBEGIN\b(?![\s\S]*\bEND\b)/i.test(stripLiterals(cur))) {
      if (stripLiterals(cur).trim()) out.push(cur.trim());
      cur = "";
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  if (stripLiterals(cur).trim()) out.push(cur.trim());
  return out;
}

/** Returns a reason string if the statement looks destructive, else null. */
export function destructiveReason(stmt: string): string | null {
  const s = stripLiterals(stmt).replace(/\s+/g, " ").trim().toUpperCase();
  if (/^DROP\b/.test(s)) return "DROP statement";
  if (/^ALTER\b/.test(s)) return "ALTER statement";
  if (/^VACUUM\b/.test(s)) return "VACUUM";
  if (/^(ATTACH|DETACH)\b/.test(s)) return "ATTACH/DETACH";
  if (/^PRAGMA\b.*=/.test(s)) return "PRAGMA assignment";
  // Strip a leading WITH clause crudely by looking for the main verb anywhere.
  if (/(^|\s)DELETE FROM\b/.test(s) && !/\bWHERE\b/.test(s)) return "DELETE without WHERE";
  if (/(^|\s)UPDATE\b/.test(s) && /\bSET\b/.test(s) && !/\bWHERE\b/.test(s)) return "UPDATE without WHERE";
  return null;
}
