import { join } from "node:path";
import { Hono } from "hono";
import { HUB_ROOT, PORT, ensureDirs } from "./config";
import { HttpError } from "./safety";
import { databases } from "./routes/databases";
import { query } from "./routes/query";
import { importRoute } from "./routes/import";
import { discovered } from "./routes/discovered";
import { DEV_ID_RE, discover, findDevDb } from "./discovery";

ensureDirs();

export const app = new Hono();

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
  // SQLite errors (syntax, constraint, etc.) are user-facing in a DB tool.
  if (err.name === "SQLiteError") return c.json({ error: err.message }, 400);
  console.error(err);
  return c.json({ error: err.message }, 500);
});

// After a server restart the browser may ask for a dev database before any scan has run.
app.use("/api/databases/:db/*", async (c, next) => {
  const db = c.req.param("db");
  if (DEV_ID_RE.test(db) && !findDevDb(db)) await discover(true);
  await next();
});

app.route("/api/databases", databases);
app.route("/api/databases", query);
app.route("/api/import", importRoute);
app.route("/api/discovered", discovered);
app.get("/api/health", (c) => c.json({ ok: true, root: HUB_ROOT }));

if (process.env.NODE_ENV === "production") {
  const dist = join(import.meta.dir, "../../web/dist");
  app.get("*", async (c) => {
    const path = c.req.path === "/" ? "/index.html" : c.req.path;
    const file = Bun.file(join(dist, path));
    if (!path.includes("..") && (await file.exists())) return new Response(file);
    return new Response(Bun.file(join(dist, "index.html")));
  });
}

if (import.meta.main) {
  Bun.serve({ hostname: "127.0.0.1", port: PORT, fetch: app.fetch });
  console.log(`SQLite Hub API on http://127.0.0.1:${PORT}  (root: ${HUB_ROOT})`);
}
