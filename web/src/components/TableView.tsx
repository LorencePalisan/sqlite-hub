import { useEffect, useState } from "react";
import { api, type RowsPage, type TableSchema } from "../api";
import { ResultGrid } from "./ResultGrid";
import { Button, ErrorBox } from "./ui";

const PAGE_SIZE = 100;

export function TableView({ db, table, refreshKey }: { db: string; table: string; refreshKey: number }) {
  const [tab, setTab] = useState<"data" | "schema">("data");
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-4 border-b border-line bg-panel px-4">
        <h1 className="py-2.5 text-[14px] font-semibold">{table}</h1>
        <div className="flex">
          {(["data", "schema"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`border-b-2 px-3 py-2.5 capitalize ${tab === t ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {tab === "data" ? (
          <DataTab key={`${db}/${table}`} db={db} table={table} refreshKey={refreshKey} />
        ) : (
          <SchemaTab db={db} table={table} refreshKey={refreshKey} />
        )}
      </div>
    </div>
  );
}

function DataTab({ db, table, refreshKey }: { db: string; table: string; refreshKey: number }) {
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<{ column: string; dir: "asc" | "desc" } | null>(null);
  const [page, setPage] = useState<RowsPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    api
      .rows(db, table, { limit: PAGE_SIZE, offset, orderBy: sort?.column, dir: sort?.dir })
      .then(setPage, (e) => setError(e.message));
  }, [db, table, offset, sort, refreshKey]);

  const onSort = (column: string) => {
    setOffset(0);
    setSort((s) =>
      s?.column !== column ? { column, dir: "asc" } : s.dir === "asc" ? { column, dir: "desc" } : null,
    );
  };

  if (error) return <div className="p-4"><ErrorBox message={error} /></div>;
  if (!page) return <div className="p-4 text-muted">Loading…</div>;

  const end = Math.min(offset + page.rows.length, page.total);
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        <ResultGrid columns={page.columns} rows={page.rows} sort={sort} onSort={onSort} rowOffset={offset} />
      </div>
      <div className="flex items-center justify-between border-t border-line bg-panel px-4 py-2 text-muted">
        <span className="tabular-nums">
          {page.total === 0 ? "0 rows" : `${offset + 1}–${end} of ${page.total.toLocaleString()}`}
        </span>
        <div className="flex gap-1.5">
          <Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
            ← Prev
          </Button>
          <Button disabled={end >= page.total} onClick={() => setOffset(offset + PAGE_SIZE)}>
            Next →
          </Button>
        </div>
      </div>
    </div>
  );
}

function SchemaTab({ db, table, refreshKey }: { db: string; table: string; refreshKey: number }) {
  const [schema, setSchema] = useState<TableSchema | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    api.schema(db, table).then(setSchema, (e) => setError(e.message));
  }, [db, table, refreshKey]);

  if (error) return <div className="p-4"><ErrorBox message={error} /></div>;
  if (!schema) return <div className="p-4 text-muted">Loading…</div>;

  return (
    <div className="h-full space-y-6 overflow-y-auto p-5">
      <Section title="Columns">
        <table className="w-full">
          <thead className="bg-raised text-left text-[11px] tracking-wide text-muted uppercase">
            <tr>
              {["Name", "Type", "Not null", "Default", "PK"].map((h) => (
                <th key={h} className="px-3 py-2 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono text-[12px]">
            {schema.columns.map((c) => (
              <tr key={c.cid} className="border-t border-line">
                <td className="px-3 py-1.5 font-semibold">{c.name}</td>
                <td className="px-3 py-1.5 text-accent">{c.type || "—"}</td>
                <td className="px-3 py-1.5">{c.notnull ? "✓" : ""}</td>
                <td className="px-3 py-1.5 text-muted">{c.dflt_value ?? ""}</td>
                <td className="px-3 py-1.5">{c.pk ? c.pk : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {schema.indexes.length > 0 && (
        <Section title="Indexes">
          <ul className="divide-y divide-line font-mono text-[12px]">
            {schema.indexes.map((i) => (
              <li key={i.name} className="px-3 py-1.5">
                {i.name}
                <span className="ml-2 text-muted">
                  {i.unique ? "unique" : ""} {i.origin === "pk" ? "primary key" : i.origin === "u" ? "constraint" : ""}
                  {i.partial ? " partial" : ""}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {schema.foreignKeys.length > 0 && (
        <Section title="Foreign keys">
          <ul className="divide-y divide-line font-mono text-[12px]">
            {schema.foreignKeys.map((f, i) => (
              <li key={i} className="px-3 py-1.5">
                {f.from} → {f.table}.{f.to}
                <span className="ml-2 text-muted">
                  on delete {f.on_delete.toLowerCase()}, on update {f.on_update.toLowerCase()}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {schema.sql && (
        <Section title="Definition">
          <pre className="overflow-x-auto p-3 font-mono text-[12px] whitespace-pre-wrap">{schema.sql}</pre>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-[12px] font-semibold tracking-wide text-muted uppercase">{title}</h2>
      <div className="overflow-hidden rounded-lg border border-line bg-panel">{children}</div>
    </section>
  );
}
