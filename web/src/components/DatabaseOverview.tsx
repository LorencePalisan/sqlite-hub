import { useEffect, useState } from "react";
import { api, dbTitle, formatBytes, type DbDetail, type DbFile } from "../api";
import { Button, ErrorBox } from "./ui";

export function DatabaseOverview({
  file,
  refreshKey,
  onOpenTable,
  onOpenSql,
  onCopiedToHub,
  onOpenDiagram,
}: {
  file: DbFile;
  refreshKey: number;
  onOpenTable: (table: string) => void;
  onOpenSql: () => void;
  onCopiedToHub: (name: string) => void;
  onOpenDiagram: () => void;
}) {
  const [detail, setDetail] = useState<DbDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    api.database(file.name).then(setDetail, (e) => setError(e.message));
  }, [file.name, refreshKey]);

  const backup = async () => {
    try {
      const { backup } = await api.backup(file.name);
      setBackupMsg(`Saved backups/${backup}`);
    } catch (e) {
      setBackupMsg((e as Error).message);
    }
  };

  const copyToHub = async () => {
    try {
      onCopiedToHub((await api.importDb(file.path!, `${file.project}-${file.label}`)).name);
    } catch (e) {
      setBackupMsg((e as Error).message);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{dbTitle(file)}</h1>
          <p className="mt-1 text-muted">
            {file.kind === "d1" && "Wrangler local D1 · "}
            {formatBytes(file.size)} · modified {new Date(file.mtime).toLocaleString()}
          </p>
          {file.path && (
            <p className="mt-1 font-mono text-[11.5px] break-all text-muted" title="Path on disk">
              {file.path}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          {file.path && (
            <Button title="Snapshot this database into ~/SQLiteHub/databases" onClick={copyToHub}>
              Copy to hub
            </Button>
          )}
          <Button onClick={backup}>Back up</Button>
          <Button onClick={onOpenDiagram}>Relations diagram</Button>
          <Button variant="primary" onClick={onOpenSql}>
            Open SQL editor
          </Button>
        </div>
      </div>
      {backupMsg && <p className="mb-4 text-ok">{backupMsg}</p>}
      {error && <ErrorBox message={error} />}
      {detail && (
        <>
          <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Tables", detail.objects.filter((o) => o.type === "table").length],
              ["Views", detail.objects.filter((o) => o.type === "view").length],
              ["Journal mode", detail.journalMode],
              ["SQLite", detail.sqliteVersion],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-line bg-panel px-4 py-3">
                <dt className="text-[11px] tracking-wide text-muted uppercase">{k}</dt>
                <dd className="mt-1 text-[16px] font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="overflow-hidden rounded-lg border border-line bg-panel">
            <table className="w-full">
              <thead className="bg-raised text-left text-[11px] tracking-wide text-muted uppercase">
                <tr>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 text-right font-medium">Rows</th>
                </tr>
              </thead>
              <tbody>
                {detail.objects.map((o) => (
                  <tr
                    key={o.name}
                    onClick={() => onOpenTable(o.name)}
                    className="cursor-pointer border-t border-line hover:bg-raised"
                  >
                    <td className="px-4 py-2 font-medium">{o.name}</td>
                    <td className="px-4 py-2 text-muted">{o.type}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{o.rowCount ?? "—"}</td>
                  </tr>
                ))}
                {detail.objects.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-muted">
                      No tables yet. Use the SQL editor to create one.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
