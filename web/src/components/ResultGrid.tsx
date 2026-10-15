import type { Cell } from "../api";

function CellView({ value }: { value: Cell }) {
  if (value === null) return <span className="text-muted/70 italic">NULL</span>;
  if (typeof value === "object") return <span className="text-muted">BLOB · {value.$blob} B</span>;
  if (value === "") return <span className="text-muted/50">''</span>;
  if (typeof value === "number") return <span className="tabular-nums">{value}</span>;
  return <>{value.length > 300 ? `${value.slice(0, 300)}…` : value}</>;
}

export function ResultGrid({
  columns,
  rows,
  sort,
  onSort,
  rowOffset = 0,
}: {
  columns: string[];
  rows: Cell[][];
  sort?: { column: string; dir: "asc" | "desc" } | null;
  onSort?: (column: string) => void;
  rowOffset?: number;
}) {
  return (
    <div className="h-full overflow-auto">
      <table className="min-w-full border-separate border-spacing-0 font-mono text-[12px]">
        <thead className="sticky top-0 z-10 bg-raised">
          <tr>
            <th className="w-12 border-b border-r border-line px-2 py-1.5 text-right font-normal text-muted">#</th>
            {columns.map((c, i) => (
              <th
                key={i}
                onClick={onSort ? () => onSort(c) : undefined}
                className={`border-b border-r border-line px-2.5 py-1.5 text-left font-semibold whitespace-nowrap ${onSort ? "cursor-pointer select-none hover:bg-line/50" : ""}`}
              >
                {c}
                {sort?.column === c && <span className="ml-1 text-accent">{sort.dir === "asc" ? "▲" : "▼"}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="hover:bg-raised/60">
              <td className="border-b border-r border-line px-2 py-1 text-right text-muted tabular-nums">
                {rowOffset + r + 1}
              </td>
              {row.map((v, i) => (
                <td
                  key={i}
                  title={typeof v === "string" ? v : undefined}
                  className="max-w-[28rem] truncate border-b border-r border-line px-2.5 py-1"
                >
                  <CellView value={v} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className="p-6 text-center text-muted">No rows</div>}
    </div>
  );
}
