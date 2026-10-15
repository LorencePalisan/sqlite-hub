import { useEffect, useState, type ReactNode } from "react";
import { api, formatBytes, type DbFile, type DbObject } from "../api";
import { Button } from "./ui";

export type View = { kind: "overview" } | { kind: "table"; table: string } | { kind: "sql" } | { kind: "diagram" };

export function Sidebar({
  databases,
  devDbs,
  devScanning,
  selected,
  view,
  onSelect,
  onRefresh,
  onRescanDev,
  onImport,
  onCreate,
  refreshKey,
}: {
  databases: DbFile[];
  devDbs: DbFile[] | null;
  devScanning: boolean;
  selected: string | null;
  view: View;
  onSelect: (db: string, view: View) => void;
  onRefresh: () => void;
  onRescanDev: () => void;
  onImport: () => void;
  onCreate: () => void;
  refreshKey: number;
}) {
  const projects = new Map<string, DbFile[]>();
  for (const d of devDbs ?? []) projects.set(d.projectDir!, [...(projects.get(d.projectDir!) ?? []), d]);
  const item = (d: DbFile) => (
    <DbItem
      key={d.name}
      db={d}
      active={selected === d.name}
      view={view}
      onSelect={onSelect}
      refreshKey={refreshKey}
    />
  );

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
        <div className="flex items-center gap-2 font-semibold">
          <img src="/logo.svg" alt="" className="size-6" />
          <span>
            SQLite <span className="text-accent">Hub</span>
          </span>
        </div>
        <Button variant="ghost" title="Rescan folder" onClick={onRefresh}>
          ↻
        </Button>
      </div>
      <div className="flex gap-1.5 border-b border-line px-3 py-2">
        <Button className="flex-1 justify-center" onClick={onImport}>
          Import…
        </Button>
        <Button className="flex-1 justify-center" onClick={onCreate}>
          New
        </Button>
      </div>
      <nav className="flex-1 overflow-y-auto py-1">
        <SectionHeading>Hub</SectionHeading>
        {databases.length === 0 && (
          <p className="px-3 pb-3 text-muted">
            No databases yet. Drop <code>.sqlite</code> files into <code>~/SQLiteHub/databases</code> or import one.
          </p>
        )}
        {databases.map(item)}

        <SectionHeading
          action={
            <button
              title="Search your projects for SQLite files again"
              disabled={devScanning}
              onClick={onRescanDev}
              className="text-muted normal-case hover:text-fg disabled:opacity-50"
            >
              {devScanning ? "Scanning…" : "Rescan"}
            </button>
          }
        >
          Dev projects
        </SectionHeading>
        {devDbs === null && <p className="px-3 pb-3 text-muted">Searching your projects…</p>}
        {devDbs?.length === 0 && <p className="px-3 pb-3 text-muted">No SQLite files found in your projects.</p>}
        {[...projects].map(([dir, dbs]) => (
          <div key={dir} className="pb-1">
            <div title={dir} className="truncate px-3 pt-1.5 pb-0.5 text-[11.5px] font-medium text-muted">
              {dbs[0].project}
            </div>
            {dbs.map(item)}
          </div>
        ))}
      </nav>
    </aside>
  );
}

function SectionHeading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 pt-3 pb-1 text-[10.5px] font-semibold tracking-wide text-muted uppercase">
      {children}
      {action}
    </div>
  );
}

function DbItem({
  db,
  active,
  view,
  onSelect,
  refreshKey,
}: {
  db: DbFile;
  active: boolean;
  view: View;
  onSelect: (db: string, view: View) => void;
  refreshKey: number;
}) {
  const [open, setOpen] = useState(false);
  const [objects, setObjects] = useState<DbObject[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api.database(db.name).then(
      (d) => !cancelled && setObjects(d.objects),
      () => !cancelled && setObjects([]),
    );
    return () => {
      cancelled = true;
    };
  }, [open, db.name, refreshKey]);

  const toggle = () => setOpen((o) => !o);

  return (
    <div>
      <div
        className={`group flex cursor-pointer items-center gap-1.5 px-2 py-1.5 ${active && view.kind !== "table" ? "bg-accent/12 text-fg" : "hover:bg-raised"}`}
        onClick={() => onSelect(db.name, { kind: "overview" })}
      >
        <button
          className="w-4 text-muted hover:text-fg"
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
        >
          {open ? "▾" : "▸"}
        </button>
        <span className="flex-1 truncate font-medium" title={db.path}>
          {db.label ?? db.name}
        </span>
        <button
          title="Relations diagram"
          className={`rounded px-1 font-mono text-[10.5px] group-hover:inline ${active && view.kind === "diagram" ? "inline bg-accent text-accent-fg" : "hidden text-muted hover:text-fg"}`}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(db.name, { kind: "diagram" });
          }}
        >
          ERD
        </button>
        <button
          title="Open SQL editor"
          className={`rounded px-1 font-mono text-[10.5px] group-hover:inline ${active && view.kind === "sql" ? "inline bg-accent text-accent-fg" : "hidden text-muted hover:text-fg"}`}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(db.name, { kind: "sql" });
          }}
        >
          SQL
        </button>
        <span className="text-[11px] text-muted group-hover:hidden">{formatBytes(db.size)}</span>
      </div>
      {open && (
        <ul className="pb-1">
          {objects === null && <li className="py-1 pl-9 text-muted">Loading…</li>}
          {objects?.length === 0 && <li className="py-1 pl-9 text-muted">Empty</li>}
          {objects?.map((o) => (
            <li
              key={o.name}
              onClick={() => onSelect(db.name, { kind: "table", table: o.name })}
              className={`flex cursor-pointer items-center gap-2 py-1 pr-3 pl-8 ${active && view.kind === "table" && view.table === o.name ? "bg-accent/12" : "hover:bg-raised"}`}
            >
              <span className="w-3 text-[10px] text-muted">{o.type === "view" ? "◇" : "▦"}</span>
              <span className="flex-1 truncate">{o.name}</span>
              {o.rowCount !== null && <span className="text-[11px] text-muted tabular-nums">{o.rowCount}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
