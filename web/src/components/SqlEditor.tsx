import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { sql, SQLite } from "@codemirror/lang-sql";
import { keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { api, ApiError, type QueryResponse } from "../api";
import { ResultGrid } from "./ResultGrid";
import { Button, ErrorBox, Modal } from "./ui";

const HISTORY_KEY = "sqlite-hub:history";
const DRAFT_KEY = (db: string) => `sqlite-hub:draft:${db}`;

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable; history is a convenience only.
  }
}

const dark = typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;

export function SqlEditor({ db, title, onChanged }: { db: string; title: string; onChanged: () => void }) {
  const [code, setCode] = useState(() => load(DRAFT_KEY(db), "SELECT name, type FROM sqlite_schema;"));
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const [history, setHistory] = useState<{ db: string; title?: string; sql: string; at: number }[]>(() => load(HISTORY_KEY, []));
  const [showHistory, setShowHistory] = useState(false);
  const [schema, setSchema] = useState<Record<string, string[]>>({});
  const codeRef = useRef(code);
  codeRef.current = code;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const detail = await api.database(db);
      const entries = await Promise.all(
        detail.objects.map(async (o) => [o.name, (await api.schema(db, o.name)).columns.map((c) => c.name)] as const),
      );
      if (!cancelled) setSchema(Object.fromEntries(entries));
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [db, result]);

  useEffect(() => save(DRAFT_KEY(db), code), [db, code]);

  const run = useCallback(
    async (confirmed = false) => {
      const text = codeRef.current.trim();
      if (!text) return;
      setRunning(true);
      setError(null);
      try {
        const res = await api.query(db, text, confirmed);
        setResult(res);
        setConfirm(null);
        setHistory((h) => {
          const next = [{ db, title, sql: text, at: Date.now() }, ...h.filter((x) => x.sql !== text)].slice(0, 100);
          save(HISTORY_KEY, next);
          return next;
        });
        if (res.results.some((r) => r.columns.length === 0)) onChanged();
      } catch (e) {
        if (e instanceof ApiError && e.status === 409 && e.body.reasons) setConfirm(e.body.reasons);
        else setError((e as Error).message);
      } finally {
        setRunning(false);
      }
    },
    [db, title, onChanged],
  );

  const extensions = useMemo(
    () => [
      sql({ dialect: SQLite, schema, upperCaseKeywords: true }),
      Prec.highest(keymap.of([{ key: "Mod-Enter", run: () => (run(), true), preventDefault: true }])),
    ],
    [schema, run],
  );

  const last = result?.results.findLast((r) => r.columns.length > 0) ?? null;
  const changes = result?.results.reduce((n, r) => n + r.changes, 0) ?? 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line bg-panel px-4 py-2">
        <h1 className="mr-auto text-[14px] font-semibold">SQL · {title}</h1>
        <Button variant="ghost" onClick={() => setShowHistory((s) => !s)}>
          History
        </Button>
        <Button variant="primary" disabled={running} onClick={() => run()}>
          {running ? "Running…" : "Run"} <kbd className="opacity-70">⌘↵</kbd>
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="h-[38%] min-h-32 border-b border-line bg-panel">
            <CodeMirror
              value={code}
              onChange={setCode}
              extensions={extensions}
              theme={dark ? "dark" : "light"}
              height="100%"
              style={{ height: "100%" }}
              basicSetup={{ highlightActiveLine: false }}
            />
          </div>

          <div className="flex items-center gap-3 border-b border-line bg-panel px-4 py-1.5 text-muted">
            {result ? (
              <>
                <span>{result.ms} ms</span>
                {last && (
                  <span>
                    {last.rows.length.toLocaleString()} row{last.rows.length === 1 ? "" : "s"}
                    {last.truncated && " (truncated at 5,000)"}
                  </span>
                )}
                {changes > 0 && <span>{changes} row(s) changed</span>}
                {result.results.length > 1 && <span>{result.results.length} statements</span>}
                {result.backup && <span className="text-ok">Backup: backups/{result.backup}</span>}
              </>
            ) : (
              <span>Run a query to see results.</span>
            )}
          </div>

          <div className="min-h-0 flex-1 bg-panel">
            {error ? (
              <div className="p-4">
                <ErrorBox message={error} />
              </div>
            ) : last ? (
              <ResultGrid columns={last.columns} rows={last.rows} />
            ) : result ? (
              <div className="p-6 text-muted">Statement executed. No result set.</div>
            ) : null}
          </div>
        </div>

        {showHistory && (
          <aside className="w-72 shrink-0 overflow-y-auto border-l border-line bg-panel">
            <div className="flex items-center justify-between px-3 py-2 text-[11px] tracking-wide text-muted uppercase">
              History
              <button
                className="normal-case hover:text-fg"
                onClick={() => {
                  setHistory([]);
                  save(HISTORY_KEY, []);
                }}
              >
                Clear
              </button>
            </div>
            {history.length === 0 && <p className="px-3 text-muted">Nothing yet.</p>}
            {history.map((h) => (
              <button
                key={h.at}
                onClick={() => setCode(h.sql)}
                className="block w-full border-t border-line px-3 py-2 text-left hover:bg-raised"
              >
                <div className="line-clamp-3 font-mono text-[11.5px]">{h.sql}</div>
                <div className="mt-1 text-[11px] text-muted">
                  {h.title ?? h.db} · {new Date(h.at).toLocaleTimeString()}
                </div>
              </button>
            ))}
          </aside>
        )}
      </div>

      {confirm && (
        <Modal title="Confirm destructive query" onClose={() => setConfirm(null)}>
          <p className="mb-2">This query contains:</p>
          <ul className="mb-3 list-disc pl-5 text-danger">
            {confirm.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <p className="mb-4 text-muted">A snapshot of {title} will be saved to backups/ before it runs.</p>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant="danger" disabled={running} onClick={() => run(true)}>
              Back up &amp; run
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
