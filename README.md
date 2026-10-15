# SQLite Hub

A local SQLite manager for your Mac. It keeps a home for your own databases in `~/SQLiteHub`, and it also finds the SQLite databases your development projects use, including Wrangler's local D1 databases, so you can browse, query and diagram them in the browser.

```
~/SQLiteHub/
  databases/   # any .sqlite / .sqlite3 / .db file here shows up automatically
  backups/     # snapshots (manual, and automatic before destructive queries)
```

## Quick start

Requires [Bun](https://bun.sh).

```sh
bun install
bun run dev     # API on 127.0.0.1:4517 + UI on http://localhost:5173
bun run start   # build the UI and serve everything from http://127.0.0.1:4517
bun run seed    # create a sample experiments.sqlite
bun run test    # server tests
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `HUB_ROOT` | `~/SQLiteHub` | Folder that holds `databases/` and `backups/`. |
| `HUB_SCAN_ROOTS` | your home folder | Where to search for dev databases. Colon-separated, `~` allowed, e.g. `~/Desktop:~/Projects`. |
| `PORT` | `4517` | API port. |

## Features

### Database sources

- **Hub databases:** every SQLite file in `~/SQLiteHub/databases` is listed under **Hub**. Files you add, change or delete in Finder show up within 5 seconds.
- **Dev project discovery:** searches your projects for SQLite files and lists them under **Dev projects**, grouped by project. You browse and query them in place, without copying.
  - **What's found:** files ending in `.sqlite`, `.sqlite3`, `.db`, `.db3`, `.s3db` or `.sl3` that really are SQLite (the file header is checked). That covers files like Prisma's `dev.db`, Laravel's `database.sqlite` and Django's `db.sqlite3`.
  - **Wrangler / Cloudflare D1:** local D1 databases in `.wrangler/state/v3/d1` are included. Each one is labelled with its `database_name` from `wrangler.toml` / `wrangler.json(c)` when the project has a single D1 file; otherwise it shows the start of the file's hash. Wrangler's KV, R2, cache, Durable Object and trace files are skipped.
  - **Projects:** a database belongs to the nearest folder containing a project marker (`package.json`, `wrangler.*`, `composer.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `Gemfile` or `.git`).
  - **What's skipped:** `node_modules`, `vendor`, build folders, hidden folders (except `.wrangler`), `~/Library`, media folders and `.app` bundles. Symlinks aren't followed, and the search stops 10 folders deep.
  - **Rescanning:** results are cached and rescanned every minute, or right away with **Rescan**.
- **Import:** copies a consistent snapshot of any SQLite file on disk into the hub using `VACUUM INTO`. The original is opened read-only and never moved. Use it for databases other apps are using.
- **Copy to hub:** the same snapshot, available as a button on any discovered dev database.
- **New database:** creates an empty database in the hub. `.sqlite` is added if you leave off an extension.

### Browsing

- **Overview:**
  - Shows each database's tables and views with row counts, journal mode, SQLite version, file size and last-modified time.
  - Dev databases also show their full path on disk.
- **Sidebar tree:** expand a database to see its tables and views with row counts. The quick buttons that appear on hover jump to the diagram (**ERD**) or the **SQL** editor.
- **Table data:**
  - Rows load 100 per page. Click a column header to sort ascending, then descending, then off.
  - Shows `NULL` and empty strings distinctly, BLOBs as `BLOB · n B`, and shortens long text, with the full value on hover.
- **Table schema:** columns (type, not null, default, primary key), indexes (unique, primary key, constraint, partial), foreign keys with their on delete / on update actions, and the `CREATE` statement.
- **Live refresh:** open views reload when the database file changes on disk, for example while your app or `wrangler dev` writes to it.
- **Links you can bookmark:** the current database and view are kept in the URL (`#/db/<name>/table/<table>`, `/sql`, `/diagram`). Reloading and the browser's back and forward buttons keep your place.

### Relations diagram

An interactive diagram of how a database's tables relate (an ER diagram). Open it with **Relations diagram** on a database's page, or the **ERD** button in the sidebar.

- **Layout:** tables flow left to right. Referenced tables come first, then the tables that point at them. Tall columns wrap into side-by-side columns, and unlinked tables go last.
- **Tables:** each box shows the table's row count and its columns with types. **PK** and **FK** mark primary-key and foreign-key columns.
- **Links:**
  - Lines connect the exact columns involved. A crow's foot (⋔) marks the "many" side and a bar (|) the "one" side.
  - Solid lines are declared `FOREIGN KEY`s.
  - Dashed lines are guessed from column names such as `user_id` → `users.id`. This is useful for schemas, common with D1, that don't declare foreign keys. The **Guessed links** toggle hides them.
- **Less clutter:** full-text search helper tables (`*_fts_data`, `*_idx`, …) and Cloudflare's `_cf_*` tables are left out. Tables with no links are hidden until you tick **Unlinked tables**.
- **Highlight:** hover or click a table to highlight its links, the connected columns and the related tables, and fade everything else. Double-click a table to open it.
- **Navigate:**
  - Drag the background or scroll with two fingers to pan. Pinch or ⌘-scroll to zoom (10%–200%), or use the − / + buttons.
  - **Fit** shows the whole diagram. **Find table…** jumps to a table.
- **Rearrange:** drag tables to move them. Positions are remembered per database in your browser, and **Reset layout** returns to the automatic layout.
- **Export PNG:** downloads the whole diagram, including the parts off screen, as it's currently filtered. It's rendered at 2× in the current light or dark theme, with a title and summary line.

### SQL editor

- Syntax highlighting and autocompletion of table and column names from the database's schema.
- **⌘↵** runs the editor's contents.
- Multi-statement scripts run in a single transaction, so if one statement fails, none of the changes are kept.
- Shows up to 5,000 rows per result, plus timing, rows changed and the statement count.
- Each database keeps its own unsaved draft. A shared **History** of your last 100 queries can be clicked to reuse or cleared. Both are stored in your browser.

### Safety

- **Confirmation for destructive statements:** this covers `DROP`, `ALTER`, `VACUUM`, `ATTACH`/`DETACH`, `PRAGMA` assignments, and `UPDATE` or `DELETE` without a `WHERE` clause. The app asks before running one and saves a snapshot to `backups/` first.
- **Manual backups:** **Back up** on any database's page saves a timestamped snapshot to `backups/`.
- **Read-only where possible:** browsing, the diagram and imports open databases read-only. Each request opens a short-lived connection and closes it, so no file stays locked.
- **Localhost only:** the server listens on `127.0.0.1` only.
- **No arbitrary file access:**
  - Hub database names are validated, so a request can't reach paths outside `databases/`.
  - Dev databases are addressed by an ID (`dev-…`) that only resolves to files the scanner found.
- **Edits to dev databases change the real file.** Use **Copy to hub** to experiment on a copy instead.

### Look and feel

- Light and dark themes follow your system setting.
- The SVG logo (`web/public/logo.svg`) is used for both the favicon and the sidebar.

## Hosting

SQLite Hub is meant to run on your own machine: discovering and opening local files needs the local Bun server. To reach it from other devices, expose the local server through something like Cloudflare Tunnel, and put authentication (for example Cloudflare Access) in front of it. Never expose it without authentication: it gives full read/write SQL access to your databases.

## Project layout

```
server/            Bun + Hono API (127.0.0.1:4517)
  src/
    index.ts         app setup, routes, production static file serving
    config.ts        HUB_ROOT, HUB_SCAN_ROOTS, PORT
    registry.ts      hub folder scan, SQLite header check
    discovery.ts     dev project scan and cache
    connections.ts   opening databases, snapshots
    relations.ts     tables, declared and guessed relationships
    safety.ts        name validation, statement splitting, destructive checks
    routes/          databases, query, import, discovered
  test/hub.test.ts
web/               React + Vite + Tailwind UI (localhost:5173 in dev)
  src/components/
    Sidebar.tsx, DatabaseOverview.tsx, TableView.tsx, SqlEditor.tsx, ResultGrid.tsx
    ErDiagram.tsx, diagramLayout.ts, diagramPng.ts
```

## API

All routes are under `/api`. A database is addressed by its hub file name, or by a discovered database's `dev-…` ID.

| Method & path | Description |
|---|---|
| `GET /health` | Server status and hub root. |
| `GET /databases` | Hub databases. |
| `POST /databases` | Create an empty hub database: `{ "name": "app" }`. |
| `GET /discovered[?refresh=1]` | Dev project databases (cached; `refresh=1` forces a rescan). |
| `GET /databases/:db` | Tables and views with row counts, plus database info. |
| `GET /databases/:db/tables/:table/rows?limit&offset&orderBy&dir` | A page of rows. |
| `GET /databases/:db/tables/:table/schema` | Columns, indexes, foreign keys, definition. |
| `GET /databases/:db/relations` | Tables, columns and relationships for the diagram. |
| `POST /databases/:db/query` | Run SQL: `{ "sql": "...", "confirm": false }`. Returns `409` with `reasons` when confirmation is needed. |
| `POST /databases/:db/backup` | Snapshot into `backups/`. |
| `POST /import` | Snapshot a file into the hub: `{ "path": "~/app/dev.db", "name": "optional" }`. |
