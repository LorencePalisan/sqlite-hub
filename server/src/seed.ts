import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DATABASES_DIR, ensureDirs } from "./config";

ensureDirs();
const path = join(DATABASES_DIR, "experiments.sqlite");
if (existsSync(path)) {
  console.log(`${path} already exists; leaving it alone.`);
  process.exit(0);
}

const db = new Database(path, { create: true });
db.run("PRAGMA journal_mode = WAL");
db.run(`
  CREATE TABLE projects (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','done')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
db.run(`
  CREATE TABLE runs (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    score REAL,
    notes TEXT,
    payload BLOB,
    started_at TEXT NOT NULL
  )`);
db.run("CREATE INDEX runs_project ON runs(project_id)");
db.run(`CREATE VIEW project_scores AS
  SELECT p.name, COUNT(r.id) AS runs, ROUND(AVG(r.score), 3) AS avg_score
  FROM projects p LEFT JOIN runs r ON r.project_id = p.id GROUP BY p.id`);

const names = ["atlas", "beacon", "cinder", "delta", "ember"];
const insP = db.prepare("INSERT INTO projects (name, status) VALUES (?, ?)");
const insR = db.prepare("INSERT INTO runs (project_id, score, notes, payload, started_at) VALUES (?, ?, ?, ?, ?)");
db.transaction(() => {
  names.forEach((n, i) => insP.run(n, ["active", "paused", "done"][i % 3]));
  for (let i = 0; i < 750; i++) {
    const day = new Date(Date.UTC(2026, 0, 1) + i * 3_600_000 * 7).toISOString();
    insR.run(
      (i % names.length) + 1,
      i % 17 === 0 ? null : Math.round(Math.random() * 1000) / 1000,
      i % 5 === 0 ? "" : `run #${i}`,
      i % 9 === 0 ? new Uint8Array(32 + (i % 64)) : null,
      day,
    );
  }
})();
db.close();
console.log(`Created ${path}`);
