import type { Relation, RelTable } from "../api";
import { edgeGeometry, HEAD_H, NODE_W, nodeHeight, ROW_H, rowY, type Positions } from "./diagramLayout";

const MARGIN = 40;
const TITLE_H = 56;
// Browsers refuse canvases much past ~16k px a side or ~268M px in total.
const MAX_SIDE = 16000;
const MAX_AREA = 120e6;

/**
 * Draws the whole diagram (not just what's on screen) onto a canvas in the current
 * theme's colours and downloads it as a PNG.
 */
export async function exportPng({
  tables,
  relations,
  pos,
  title,
}: {
  tables: RelTable[];
  relations: Relation[];
  pos: Positions;
  title: string;
}) {
  const root = getComputedStyle(document.documentElement);
  const color = (name: string) => root.getPropertyValue(name).trim();
  const c = {
    bg: color("--bg"),
    panel: color("--panel"),
    raised: color("--raised"),
    line: color("--line"),
    fg: color("--fg"),
    muted: color("--muted"),
    accent: color("--accent"),
  };
  const sans = getComputedStyle(document.body).fontFamily;
  const mono = root.getPropertyValue("--font-mono").trim() || "ui-monospace, Menlo, monospace";
  await document.fonts.ready;

  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const t of tables) {
    const p = pos[t.name];
    [x0, y0] = [Math.min(x0, p.x), Math.min(y0, p.y)];
    [x1, y1] = [Math.max(x1, p.x + NODE_W), Math.max(y1, p.y + nodeHeight(t))];
  }
  if (!tables.length) [x0, y0, x1, y1] = [0, 0, 400, 0];
  const w = x1 - x0 + 2 * MARGIN;
  const h = y1 - y0 + 2 * MARGIN + TITLE_H;
  const scale = Math.min(2, MAX_SIDE / w, MAX_SIDE / h, Math.sqrt(MAX_AREA / (w * h)));

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(w * scale);
  canvas.height = Math.ceil(h * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, w, h);

  const text = (s: string, x: number, y: number, font: string, fill: string, maxW: number, align: CanvasTextAlign = "left") => {
    ctx.font = font;
    ctx.fillStyle = fill;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    let out = s;
    if (ctx.measureText(out).width > maxW) {
      while (out.length > 1 && ctx.measureText(`${out}…`).width > maxW) out = out.slice(0, -1);
      out += "…";
    }
    ctx.fillText(out, x, y);
    return ctx.measureText(out).width;
  };

  text(title, MARGIN, MARGIN + 6, `600 18px ${sans}`, c.fg, w - 2 * MARGIN);
  const guessed = relations.filter((r) => r.inferred).length;
  const summary =
    `${tables.length} tables · ${relations.length - guessed} foreign keys` +
    (guessed ? ` · ${guessed} guessed from column names (dashed)` : "") +
    ` · exported ${new Date().toLocaleString()}`;
  text(summary, MARGIN, MARGIN + 28, `12px ${sans}`, c.muted, w - 2 * MARGIN);

  ctx.translate(MARGIN - x0, MARGIN + TITLE_H - y0);
  const byName = new Map(tables.map((t) => [t.name, t]));

  // Edges first so table boxes sit on top of them.
  ctx.strokeStyle = c.muted;
  ctx.lineWidth = 1.25;
  ctx.globalAlpha = 0.75;
  for (const r of relations) {
    const a = byName.get(r.from.table);
    const b = byName.get(r.to.table);
    if (!a || !b) continue;
    const pa = pos[a.name];
    const pb = pos[b.name];
    const { path, crow, bar } = edgeGeometry(pa, rowY(a, pa, r.from.column), pb, rowY(b, pb, r.to.column));
    ctx.setLineDash(r.inferred ? [5, 4] : []);
    ctx.stroke(new Path2D(path));
    ctx.setLineDash([]);
    ctx.stroke(new Path2D(crow));
    ctx.stroke(new Path2D(bar));
  }
  ctx.globalAlpha = 1;

  const fkCols = new Set(relations.map((r) => `${r.from.table}\0${r.from.column}`));
  for (const t of tables) {
    const { x, y } = pos[t.name];
    const th = nodeHeight(t);
    const box = new Path2D();
    box.roundRect(x, y, NODE_W, th, 8);
    ctx.fillStyle = c.panel;
    ctx.fill(box);

    ctx.save();
    ctx.clip(box);
    ctx.fillStyle = c.raised;
    ctx.fillRect(x, y, NODE_W, HEAD_H);
    ctx.fillStyle = c.line;
    ctx.fillRect(x, y + HEAD_H - 1, NODE_W, 1);
    ctx.restore();
    ctx.strokeStyle = c.line;
    ctx.lineWidth = 1;
    ctx.stroke(box);

    const countW =
      t.rowCount === null ? 0 : text(String(t.rowCount), x + NODE_W - 12, y + HEAD_H / 2, `11px ${sans}`, c.muted, 80, "right");
    text(t.name, x + 12, y + HEAD_H / 2, `600 13px ${sans}`, c.fg, NODE_W - 24 - countW - 8);

    t.columns.forEach((col, i) => {
      const cy = y + HEAD_H + i * ROW_H + ROW_H / 2;
      const fk = fkCols.has(`${t.name}\0${col.name}`);
      if (col.pk || fk) text(col.pk ? "PK" : "FK", x + 12, cy, `700 9.5px ${sans}`, col.pk ? c.accent : c.muted, 20);
      const typeW = text((col.type || "any").toUpperCase(), x + NODE_W - 12, cy, `10.5px ${sans}`, c.muted, 90, "right");
      text(col.name, x + 40, cy, `${col.pk ? "600 " : ""}11.5px ${mono}`, c.fg, NODE_W - 52 - typeW - 8);
    });
  }

  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("The diagram is too large to export as an image.");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "")}-relations.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
