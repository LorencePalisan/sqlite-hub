import { useCallback, useEffect, useRef, useState } from "react";
import { api, dbTitle, type DbFile } from "./api";
import { Sidebar, type View } from "./components/Sidebar";
import { DatabaseOverview } from "./components/DatabaseOverview";
import { TableView } from "./components/TableView";
import { SqlEditor } from "./components/SqlEditor";
import { ErDiagram } from "./components/ErDiagram";
import { ImportDialog, NewDatabaseDialog } from "./components/Dialogs";
import { ErrorBox } from "./components/ui";

const POLL_MS = 5000;
const DEV_SCAN_MS = 60_000;

// Location lives in the hash (#/db/<name>[/sql | /diagram | /table/<name>]) so reloads keep your place.
function parseHash(): { selected: string | null; view: View } {
  const [, db, kind, table] = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  if (!db) return { selected: null, view: { kind: "overview" } };
  if (kind === "sql") return { selected: db, view: { kind: "sql" } };
  if (kind === "diagram") return { selected: db, view: { kind: "diagram" } };
  if (kind === "table" && table) return { selected: db, view: { kind: "table", table } };
  return { selected: db, view: { kind: "overview" } };
}

function toHash(selected: string | null, view: View): string {
  if (!selected) return "";
  const base = `#/db/${encodeURIComponent(selected)}`;
  if (view.kind === "sql") return `${base}/sql`;
  if (view.kind === "diagram") return `${base}/diagram`;
  if (view.kind === "table") return `${base}/table/${encodeURIComponent(view.table)}`;
  return base;
}

export function App() {
  const initial = parseHash();
  const [databases, setDatabases] = useState<DbFile[]>([]);
  const [selected, setSelected] = useState<string | null>(initial.selected);
  const [view, setView] = useState<View>(initial.view);

  useEffect(() => {
    const next = toHash(selected, view);
    if (location.hash !== next) history.pushState(null, "", next || location.pathname);
  }, [selected, view]);

  useEffect(() => {
    const onPop = () => {
      const s = parseHash();
      setSelected(s.selected);
      setView(s.view);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const [dialog, setDialog] = useState<"import" | "new" | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const lastSig = useRef<string | null>(null);
  const [devDbs, setDevDbs] = useState<DbFile[] | null>(null);
  const [devScanning, setDevScanning] = useState(false);
  const lastDevSig = useRef<string | null>(null);

  const loadDev = useCallback(async (force = false) => {
    if (force) setDevScanning(true);
    try {
      const { databases } = await api.discovered(force);
      setDevDbs(databases);
      const sig = databases.map((d) => `${d.name}:${d.mtime}:${d.size}`).join("|");
      if (lastDevSig.current !== null && lastDevSig.current !== sig) setRefreshKey((k) => k + 1);
      lastDevSig.current = sig;
    } catch {
      setDevDbs((d) => d ?? []);
    } finally {
      setDevScanning(false);
    }
  }, []);

  useEffect(() => {
    loadDev();
    const id = setInterval(() => loadDev(), DEV_SCAN_MS);
    return () => clearInterval(id);
  }, [loadDev]);

  const loadList = useCallback(async () => {
    try {
      const list = await api.listDatabases();
      setError(null);
      setDatabases(list);
      // Bump refreshKey when any file changed on disk so open views reload.
      const sig = list.map((d) => `${d.name}:${d.mtime}:${d.size}`).join("|");
      if (lastSig.current !== null && lastSig.current !== sig) setRefreshKey((k) => k + 1);
      lastSig.current = sig;
    } catch (e) {
      setError(`Can't reach the SQLite Hub server: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => {
    loadList();
    const id = setInterval(loadList, POLL_MS);
    return () => clearInterval(id);
  }, [loadList]);

  const select = (db: string, v: View) => {
    setSelected(db);
    setView(v);
  };

  const refresh = () => {
    loadList();
    setRefreshKey((k) => k + 1);
  };

  const onAdded = (name: string) => {
    setDialog(null);
    loadList();
    select(name, { kind: "overview" });
  };

  const file = [...databases, ...(devDbs ?? [])].find((d) => d.name === selected) ?? null;

  return (
    <div className="flex h-full">
      <Sidebar
        databases={databases}
        devDbs={devDbs}
        devScanning={devScanning}
        onRescanDev={() => loadDev(true)}
        selected={selected}
        view={view}
        onSelect={select}
        onRefresh={refresh}
        onImport={() => setDialog("import")}
        onCreate={() => setDialog("new")}
        refreshKey={refreshKey}
      />
      <main className="min-w-0 flex-1">
        {error && (
          <div className="p-4">
            <ErrorBox message={error} />
          </div>
        )}
        {!file ? (
          <div className="grid h-full place-items-center text-center text-muted">
            <div>
              <img src="/logo.svg" alt="" className="mx-auto mb-3 size-24" />
              <p className="mb-4 text-[26px] font-bold tracking-tight text-fg">
                SQLite <span className="text-accent">Hub</span>
              </p>
              <p className="text-[15px] text-fg">Select a database</p>
              <p className="mt-1">
                {databases.length} in <code>~/SQLiteHub/databases</code>
                {devDbs && ` · ${devDbs.length} found in your projects`}
              </p>
            </div>
          </div>
        ) : view.kind === "table" ? (
          <TableView db={file.name} table={view.table} refreshKey={refreshKey} />
        ) : view.kind === "diagram" ? (
          <ErDiagram
            key={file.name}
            db={file.name}
            title={dbTitle(file)}
            refreshKey={refreshKey}
            onOpenTable={(t) => setView({ kind: "table", table: t })}
          />
        ) : view.kind === "sql" ? (
          <SqlEditor key={file.name} db={file.name} title={dbTitle(file)} onChanged={refresh} />
        ) : (
          <DatabaseOverview
            file={file}
            refreshKey={refreshKey}
            onOpenTable={(t) => setView({ kind: "table", table: t })}
            onOpenSql={() => setView({ kind: "sql" })}
            onOpenDiagram={() => setView({ kind: "diagram" })}
            onCopiedToHub={onAdded}
          />
        )}
      </main>
      {dialog === "import" && <ImportDialog onClose={() => setDialog(null)} onDone={onAdded} />}
      {dialog === "new" && <NewDatabaseDialog onClose={() => setDialog(null)} onDone={onAdded} />}
    </div>
  );
}
