import React, { useRef, useState } from "react";
import { C } from "../../theme.js";

// Regions drawn over the page image (P6.T2). Boxes are 0-1 on the unrotated page image (I4), so the overlay maps
// pointer positions straight to fractions of its own size. Drag to draw when `drawing`; click a region to select it.

const MIN_SIZE = 0.01; // ignore accidental clicks: a box must be at least 1% of the page in both directions
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const round = (v) => Math.round(v * 1e5) / 1e5;

/** Box from two pointer positions given as fractions. Null if too small. */
export function boxFromDrag(a, b) {
  const box = { x0: round(clamp01(Math.min(a.x, b.x))), y0: round(clamp01(Math.min(a.y, b.y))), x1: round(clamp01(Math.max(a.x, b.x))), y1: round(clamp01(Math.max(a.y, b.y))) };
  return box.x1 - box.x0 >= MIN_SIZE && box.y1 - box.y0 >= MIN_SIZE ? box : null;
}

/**
 * @param {{ regions: {id, box, label, kind}[], selectedId?: string, drawing: boolean, onDraw: (box) => void, onSelect: (id) => void, highlightIds?: Set<string> }} props
 */
export default function RegionOverlay({ regions, selectedId, drawing, onDraw, onSelect, highlightIds }) {
  const ref = useRef(null);
  const [drag, setDrag] = useState(null); // { a, b }
  const pos = (e) => {
    const r = ref.current.getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
  };
  const down = (e) => { if (!drawing) return; e.preventDefault(); ref.current.setPointerCapture?.(e.pointerId); const p = pos(e); setDrag({ a: p, b: p }); };
  const move = (e) => { if (drag) setDrag({ ...drag, b: pos(e) }); };
  const up = (e) => {
    if (!drag) return;
    const box = boxFromDrag(drag.a, pos(e));
    setDrag(null);
    if (box) onDraw(box);
  };
  const live = drag && boxFromDrag(drag.a, drag.b);
  const rect = (b) => ({ position: "absolute", left: `${b.x0 * 100}%`, top: `${b.y0 * 100}%`, width: `${(b.x1 - b.x0) * 100}%`, height: `${(b.y1 - b.y0) * 100}%` });

  return (
    <div ref={ref} data-testid="region-overlay" onPointerDown={down} onPointerMove={move} onPointerUp={up}
      style={{ position: "absolute", inset: 0, cursor: drawing ? "crosshair" : "default", touchAction: drawing ? "none" : "auto" }}>
      {regions.filter((r) => r.kind !== "page").map((r) => {
        const on = r.id === selectedId, hi = highlightIds?.has(r.id);
        return (
          <div key={r.id} data-testid="region-box" title={r.label || r.kind}
            onPointerDown={(e) => { if (!drawing) { e.stopPropagation(); onSelect(r.id); } }}
            style={{ ...rect(r.box), border: `2px solid ${on ? C.focus : hi ? C.rel[2] : C.slate}`, background: on ? "rgba(138,48,51,.10)" : "rgba(84,101,108,.06)", boxSizing: "border-box", cursor: drawing ? "crosshair" : "pointer", pointerEvents: drawing ? "none" : "auto" }} />
        );
      })}
      {live && <div data-testid="region-drawing" style={{ ...rect(live), border: `2px dashed ${C.focus}`, boxSizing: "border-box" }} />}
    </div>
  );
}
