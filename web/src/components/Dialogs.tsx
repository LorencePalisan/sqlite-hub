import { useState, type FormEvent } from "react";
import { api } from "../api";
import { Button, ErrorBox, Modal, inputClass } from "./ui";

export function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: (name: string) => void }) {
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone((await api.importDb(path.trim(), name.trim())).name);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title="Import database" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-muted">
          Takes a consistent snapshot of a SQLite file into <code>~/SQLiteHub/databases</code>. The original is
          opened read-only and left untouched.
        </p>
        <label className="block">
          <span className="mb-1 block text-[12px] text-muted">Path to file</span>
          <input
            autoFocus
            className={`${inputClass} font-mono`}
            placeholder="~/Projects/app/data.db"
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] text-muted">Name in hub (optional)</span>
          <input className={inputClass} placeholder="app.sqlite" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <p className="text-[11.5px] text-muted">Tip: in Finder, ⌥⌘C copies a file's path.</p>
        {error && <ErrorBox message={error} />}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!path.trim() || busy}>
            {busy ? "Importing…" : "Import"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function NewDatabaseDialog({ onClose, onDone }: { onClose: () => void; onDone: (name: string) => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      onDone((await api.createDatabase(name.trim())).name);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal title="New database" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <input
          autoFocus
          className={inputClass}
          placeholder="inventory"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <p className="text-[11.5px] text-muted">
          Letters, numbers, <code>_ . -</code>. <code>.sqlite</code> is added if you leave off an extension.
        </p>
        {error && <ErrorBox message={error} />}
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!name.trim()}>
            Create
          </Button>
        </div>
      </form>
    </Modal>
  );
}
