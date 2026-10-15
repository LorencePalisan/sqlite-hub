export type Cell = string | number | null | { $blob: number };

export function serializeValue(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Uint8Array) return { $blob: v.byteLength };
  if (typeof v === "number" || typeof v === "string") return v;
  return String(v);
}

export function serializeRow(row: unknown[]): Cell[] {
  return row.map(serializeValue);
}
