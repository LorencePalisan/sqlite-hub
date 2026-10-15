import dagre from "@dagrejs/dagre";
import type { Relation, RelTable } from "../api";

// Shared by the on-screen diagram and the PNG export so both draw the same geometry.
export const NODE_W = 248;
export const HEAD_H = 32;
export const ROW_H = 22;
export const PAD_B = 6;
export const GAP = 36;
export const RANK_GAP = 140;
export const MAX_COL_H = 1100;

export type Point = { x: number; y: number };
export type Positions = Record<string, Point>;

export const nodeHeight = (t: RelTable) => HEAD_H + t.columns.length * ROW_H + PAD_B;

/** Vertical centre of a column's row inside a table box at `p`. */
export const rowY = (t: RelTable, p: Point, col: string) =>
  p.y + HEAD_H + Math.max(0, t.columns.findIndex((c) => c.name === col)) * ROW_H + ROW_H / 2;

/** Left to right: referenced tables first, then the tables that point at them, then unlinked tables. */
export function layout(tables: RelTable[], relations: Relation[], linked: Set<string>): Positions {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: "LR", nodesep: GAP, ranksep: RANK_GAP });
  g.setDefaultEdgeLabel(() => ({}));
  for (const t of tables) if (linked.has(t.name)) g.setNode(t.name, { width: NODE_W, height: nodeHeight(t) });
  relations.forEach((r, i) => {
    if (r.from.table !== r.to.table) g.setEdge(r.to.table, r.from.table, {}, String(i));
  });
  dagre.layout(g);

  // Dagre picks each table's rank (column) and its order within it. A heavily referenced table
  // makes its dependents' rank very tall, so each rank is wrapped into side-by-side sub-columns.
  const ranks = new Map<number, { name: string; y: number }[]>();
  for (const name of g.nodes()) {
    const n = g.node(name);
    const key = Math.round(n.x);
    ranks.set(key, [...(ranks.get(key) ?? []), { name, y: n.y }]);
  }
  const groups = [...ranks.keys()]
    .sort((a, b) => a - b)
    .map((k) => ranks.get(k)!.sort((a, b) => a.y - b.y).map((n) => n.name));
  // Unlinked tables go last, on the right.
  const rest = tables.filter((t) => !linked.has(t.name)).map((t) => t.name);
  if (rest.length) groups.push(rest);

  const heights = new Map(tables.map((t) => [t.name, nodeHeight(t)]));
  const pos: Positions = {};
  let x = 0;
  for (const group of groups) {
    let y = 0;
    let sub = 0;
    for (const name of group) {
      const h = heights.get(name)!;
      if (y > 0 && y + h > MAX_COL_H) [sub, y] = [sub + 1, 0];
      pos[name] = { x: x + sub * (NODE_W + GAP), y };
      y += h + GAP;
    }
    x += (sub + 1) * (NODE_W + GAP) - GAP + RANK_GAP;
  }
  return pos;
}

export function edgeGeometry(a: Point, ay: number, b: Point, by: number) {
  // Leave/enter on the facing sides; when the boxes overlap horizontally, loop around the right.
  let ax: number, bx: number, da: number, db: number;
  if (a.x + NODE_W < b.x) [ax, da, bx, db] = [a.x + NODE_W, 1, b.x, -1];
  else if (b.x + NODE_W < a.x) [ax, da, bx, db] = [a.x, -1, b.x + NODE_W, 1];
  else [ax, da, bx, db] = [a.x + NODE_W, 1, b.x + NODE_W, 1];
  const c = Math.max(48, Math.abs(bx - ax) / 2);
  const path = `M${ax},${ay} C${ax + da * c},${ay} ${bx + db * c},${by} ${bx},${by}`;
  // Crow's foot ("many") at the referencing column, a bar ("one") at the referenced key.
  const crow = `M${ax + da * 12},${ay} L${ax},${ay - 6} M${ax + da * 12},${ay} L${ax},${ay} M${ax + da * 12},${ay} L${ax},${ay + 6}`;
  const bar = `M${bx + db * 8},${by - 6} L${bx + db * 8},${by + 6}`;
  return { path, crow, bar };
}
