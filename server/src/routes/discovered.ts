import { statSync } from "node:fs";
import { Hono } from "hono";
import { discover } from "../discovery";

export const discovered = new Hono().get("/", async (c) => {
  const scan = await discover(c.req.query("refresh") === "1");
  // The scan is cached, so refresh size/mtime (cheap) to keep change detection live.
  const databases = scan.databases.flatMap((d) => {
    try {
      const st = statSync(d.path);
      return [{ ...d, size: st.size, mtime: st.mtimeMs }];
    } catch {
      return []; // Deleted since the last scan.
    }
  });
  return c.json({ ...scan, databases });
});
