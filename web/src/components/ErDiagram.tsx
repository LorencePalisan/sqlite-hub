import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { api, type Relations } from "../api";
import {
  edgeGeometry,
  HEAD_H,
  layout,
  NODE_W,
  nodeHeight,
  PAD_B,
  ROW_H,
  rowY,
  type Positions,
} from "./diagramLayout";
import { exportPng } from "./diagramPng";
import { Button, ErrorBox, inputClass } from "./ui";

const MIN_K = 0.1;
const MAX_K = 2;

const posKey = (db: string) => `sqlite-hub:diagram:${db}`;

function loadPositions(db: string): Positions {
  try {
    return JSON.parse(localStorage.getItem(posKey(db)) ?? "{}") as Positions;
  } catch {
    return {};
  }
}

function savePositions(db: string, p: Positions) {
  try {
    if (Object.keys(p).length) localStorage.setItem(posKey(db), JSON.stringify(p));
    else localStorage.removeItem(posKey(db));
  } catch {
    // Storage unavailable; dragged positions just won't survive a reload.
  }
}


export function ErDiagram({
  db,
  title,
  refreshKey,
  onOpenTable,
}: {
  db: string;
  title: string;
  refreshKey: number;
  onOpenTable: (table: string) => void;
}) {
  const [data, setData] = useState<Relations | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showInferred, setShowInferred] = useState(true);
  const [showUnlinked, setShowUnlinked] = useState(false);
  const [moved, setMoved] = useState<Positions>(() => loadPositions(db));
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const fitted = useRef(false);

  useEffect(() => {
    setError(null);
    api.relations(db).then(setData, (e) => setError(e.message));
  }, [db, refreshKey]);

  useEffect(() => savePositions(db, moved), [db, moved]);

  const relations = useMemo(
    () => (data?.relations ?? []).filter((r) => showInferred || !r.inferred),
    [data, showInferred],
  );
  const linked = useMemo(() => new Set(relations.flatMap((r) => [r.from.table, r.to.table])), [relations]);
  const tables = useMemo(() => data?.tables ?? [], [data]);
  const visible = useMemo(
    () => tables.filter((t) => showUnlinked || linked.has(t.name) || linked.size === 0),
    [tables, linked, showUnlinked],
  );
  const auto = useMemo(() => layout(tables, relations, linked), [tables, relations, linked]);
  const pos = useCallback((name: string) => moved[name] ?? auto[name], [moved, auto]);

  /** Fit everything in view; `minK` keeps the first view readable for big schemas (pan to see the rest). */
  const fit = useCallback((minK = MIN_K) => {
    const el = box.current;
    if (!el || visible.length === 0) return;
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const t of visible) {
      const p = pos(t.name);
      [x0, y0] = [Math.min(x0, p.x), Math.min(y0, p.y)];
      [x1, y1] = [Math.max(x1, p.x + NODE_W), Math.max(y1, p.y + nodeHeight(t))];
    }
    const m = 40;
    const k = Math.min(1, Math.max(minK, Math.min((el.clientWidth - 2 * m) / (x1 - x0), (el.clientHeight - 2 * m) / (y1 - y0))));
    setView({ k, x: Math.max(m, (el.clientWidth - (x1 - x0) * k) / 2) - x0 * k, y: m - y0 * k });
  }, [visible, pos]);

  useLayoutEffect(() => {
    if (data && !fitted.current) {
      fitted.current = true;
      fit(0.55);
    }
  }, [data, fit]);

  const loaded = data !== null;

  // Trackpad: two-finger scroll pans, pinch (ctrlKey) zooms. ⌘/Ctrl + wheel zooms with a mouse.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        const [px, py] = [e.clientX - r.left, e.clientY - r.top];
        setView((v) => {
          const k = Math.min(MAX_K, Math.max(MIN_K, v.k * Math.exp(-e.deltaY * 0.01)));
          return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
        });
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [loaded]);

  const zoomBy = (f: number) => {
    const el = box.current!;
    const [px, py] = [el.clientWidth / 2, el.clientHeight / 2];
    setView((v) => {
      const k = Math.min(MAX_K, Math.max(MIN_K, v.k * f));
      return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
    });
  };

  const centerOn = (name: string) => {
    const el = box.current!;
    const t = tables.find((x) => x.name === name)!;
    const p = pos(name);
    const k = Math.max(view.k, 0.8);
    setView({ k, x: el.clientWidth / 2 - (p.x + NODE_W / 2) * k, y: el.clientHeight / 2 - (p.y + nodeHeight(t) / 2) * k });
  };

  const onSearch = () => {
    const q = search.trim().toLowerCase();
    if (!q) return;
    const hit =
      visible.find((t) => t.name.toLowerCase() === q) ?? tables.find((t) => t.name.toLowerCase().includes(q));
    if (!hit) return;
    if (!visible.includes(hit)) setShowUnlinked(true);
    setSelected(hit.name);
    centerOn(hit.name);
  };

  // One pointer handler for both panning the canvas and dragging a table.
  const drag = useRef<{ table: string | null; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(
    null,
  );
  const onPointerDown = (e: PointerEvent, table: string | null) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const o = table ? pos(table) : view;
    drag.current = { table, sx: e.clientX, sy: e.clientY, ox: o.x, oy: o.y, moved: false };
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const [dx, dy] = [e.clientX - d.sx, e.clientY - d.sy];
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    d.moved = true;
    if (d.table) setMoved((m) => ({ ...m, [d.table!]: { x: d.ox + dx / view.k, y: d.oy + dy / view.k } }));
    else setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }));
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) setSelected(d.table && d.table !== selected ? d.table : null);
  };

  const focus = hovered ?? selected;
  const focusEdges = useMemo(
    () => new Set(relations.filter((r) => r.from.table === focus || r.to.table === focus)),
    [relations, focus],
  );
  const focusTables = useMemo(
    () => new Set([focus, ...[...focusEdges].flatMap((r) => [r.from.table, r.to.table])]),
    [focus, focusEdges],
  );
  const fkCols = useMemo(() => new Set(relations.map((r) => `${r.from.table}\0${r.from.column}`)), [relations]);
  const focusCols = useMemo(
    () => new Set([...focusEdges].flatMap((r) => [`${r.from.table}\0${r.from.column}`, `${r.to.table}\0${r.to.column}`])),
    [focusEdges],
  );

  const onExport = async () => {
    setExporting(true);
    try {
      const names = new Set(visible.map((t) => t.name));
      await exportPng({
        tables: visible,
        relations: relations.filter((r) => names.has(r.from.table) && names.has(r.to.table)),
        pos: Object.fromEntries(visible.map((t) => [t.name, pos(t.name)])),
        title,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  if (error) return <div className="p-4"><ErrorBox message={error} /></div>;
  if (!data) return <div className="p-4 text-muted">Loading…</div>;

  const byName = new Map(tables.map((t) => [t.name, t]));
  const visibleNames = new Set(visible.map((t) => t.name));
  const inferredCount = data.relations.filter((r) => r.inferred).length;
  const unlinkedCount = tables.filter((t) => !linked.has(t.name)).length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-panel px-4 py-2">
        <div className="mr-auto min-w-0">
          <h1 className="truncate text-[14px] font-semibold">Relations · {title}</h1>
          <p className="text-[11.5px] text-muted">
            {tables.length} tables · {data.relations.length - inferredCount} foreign keys
            {inferredCount > 0 && ` · ${inferredCount} guessed from column names`}
          </p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSearch();
          }}
        >
          <input
            className={`${inputClass} w-44 py-1`}
            placeholder="Find table…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </form>
        {inferredCount > 0 && (
          <label className="flex items-center gap-1.5 text-muted">
            <input type="checkbox" checked={showInferred} onChange={(e) => setShowInferred(e.target.checked)} />
            Guessed links
          </label>
        )}
        {linked.size > 0 && unlinkedCount > 0 && (
          <label className="flex items-center gap-1.5 text-muted">
            <input type="checkbox" checked={showUnlinked} onChange={(e) => setShowUnlinked(e.target.checked)} />
            Unlinked tables ({unlinkedCount})
          </label>
        )}
        <div className="flex items-center gap-1">
          <Button variant="ghost" title="Zoom out" onClick={() => zoomBy(1 / 1.25)}>
            −
          </Button>
          <span className="w-10 text-center text-[11.5px] text-muted tabular-nums">{Math.round(view.k * 100)}%</span>
          <Button variant="ghost" title="Zoom in" onClick={() => zoomBy(1.25)}>
            +
          </Button>
          <Button onClick={() => fit()}>Fit</Button>
          <Button
            title="Download the whole diagram, as currently filtered, as a PNG"
            disabled={exporting || visible.length === 0}
            onClick={onExport}
          >
            {exporting ? "Exporting…" : "Export PNG"}
          </Button>
          {Object.keys(moved).length > 0 && (
            <Button title="Forget dragged positions" onClick={() => setMoved({})}>
              Reset layout
            </Button>
          )}
        </div>
      </div>

      <div
        ref={box}
        className="relative min-h-0 flex-1 cursor-grab touch-none overflow-hidden bg-bg select-none active:cursor-grabbing"
        style={{
          backgroundImage: "radial-gradient(var(--line) 1px, transparent 1px)",
          backgroundSize: `${20 * view.k}px ${20 * view.k}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
        }}
        onPointerDown={(e) => onPointerDown(e, null)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {tables.length === 0 && (
          <p className="absolute inset-0 grid place-items-center text-muted">This database has no tables yet.</p>
        )}
        <div className="absolute top-0 left-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
          <svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width="1" height="1">
            {relations.map((r, i) => {
              const a = byName.get(r.from.table)!;
              const b = byName.get(r.to.table)!;
              if (!visibleNames.has(a.name) || !visibleNames.has(b.name)) return null;
              const { path, crow, bar } = edgeGeometry(pos(a.name), rowY(a, pos(a.name), r.from.column), pos(b.name), rowY(b, pos(b.name), r.to.column));
              const on = focusEdges.has(r);
              const stroke = on ? "var(--accent)" : "var(--muted)";
              const opacity = focus && !on ? 0.12 : on ? 1 : 0.55;
              return (
                <g key={i} stroke={stroke} opacity={opacity} fill="none" strokeWidth={on ? 2 : 1.25}>
                  <path d={path} strokeDasharray={r.inferred ? "5 4" : undefined} />
                  <path d={crow} />
                  <path d={bar} />
                </g>
              );
            })}
          </svg>

          {visible.map((t) => {
            const p = pos(t.name);
            const dim = focus !== null && !focusTables.has(t.name);
            const isFocus = t.name === focus;
            return (
              <div
                key={t.name}
                className={`absolute cursor-pointer overflow-hidden rounded-lg border bg-panel shadow-sm transition-opacity ${isFocus ? "border-accent ring-2 ring-accent/30" : "border-line"}`}
                style={{ left: p.x, top: p.y, width: NODE_W, opacity: dim ? 0.3 : 1 }}
                onPointerDown={(e) => onPointerDown(e, t.name)}
                onPointerEnter={() => !drag.current && setHovered(t.name)}
                onPointerLeave={() => setHovered(null)}
                onDoubleClick={() => onOpenTable(t.name)}
                title="Click to highlight links · double-click to open"
              >
                <div className="flex items-center gap-2 border-b border-line bg-raised px-3" style={{ height: HEAD_H }}>
                  <span className="flex-1 truncate font-semibold">{t.name}</span>
                  {t.rowCount !== null && <span className="text-[11px] text-muted tabular-nums">{t.rowCount}</span>}
                </div>
                <div style={{ paddingBottom: PAD_B }}>
                  {t.columns.map((c) => {
                    const key = `${t.name}\0${c.name}`;
                    const fk = fkCols.has(key);
                    return (
                      <div
                        key={c.name}
                        className={`flex items-center gap-2 px-3 ${focusCols.has(key) ? "bg-accent/12" : ""}`}
                        style={{ height: ROW_H }}
                      >
                        <span className={`w-5 text-[9.5px] font-bold ${c.pk ? "text-accent" : "text-muted"}`}>
                          {c.pk ? "PK" : fk ? "FK" : ""}
                        </span>
                        <span className={`flex-1 truncate font-mono text-[11.5px] ${c.pk ? "font-semibold" : ""}`}>
                          {c.name}
                        </span>
                        <span className="text-[10.5px] text-muted uppercase">{c.type || "any"}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="pointer-events-none absolute bottom-3 left-3 flex gap-4 rounded-md border border-line bg-panel/90 px-3 py-1.5 text-[11px] text-muted">
          <Legend dash={false}>Foreign key</Legend>
          {inferredCount > 0 && <Legend dash>Guessed from name</Legend>}
          <span>⋔ many · | one</span>
          <span>Scroll to pan · pinch or ⌘ scroll to zoom</span>
        </div>
      </div>
    </div>
  );
}

function Legend({ dash, children }: { dash: boolean; children: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width="22" height="6">
        <path d="M1,3 L21,3" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray={dash ? "4 3" : undefined} />
      </svg>
      {children}
    </span>
  );
}
