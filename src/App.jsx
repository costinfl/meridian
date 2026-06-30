import React, { useState, useRef, useEffect, useMemo } from "react";
import { C, hexA, clamp, btnStyle } from "./theme.js";
import { SAMPLE_PEOPLE, SAMPLE_ANNOTATIONS, CONTEXT_LANES } from "./sampleData.js";
import { storage } from "./storage/StorageService.js";
import { useProject } from "./hooks/useProject.js";
import { Modal } from "./components/Modal.jsx";
import { ProjectManager } from "./components/ProjectManager.jsx";
import { SourcesPanel } from "./components/SourcesPanel.jsx";

/* ============================================================
   MERIDIAN — a family time atlas
   Three areas of synchronized, zoomable swimlanes:
   · CONTEXT (top): local / national / global history
   · FOCUS (middle): the person under study, with the time axis
   · COMPARE (bottom): relatives laid against the same years
   Features: point events, period bars, named groupings,
   research braces (accolades), age crosshair, GEDCOM in/out,
   project organization with multi-media sources.
   ============================================================ */

const HEADER_W = 216;
const CTX_H = 56;
const AXIS_H = 32;
const FOCUS_H = 152;
const REL_H = 116;

/* ---------------- small helpers ---------------- */

function packRows(items, gapYears = 1) {
  const rows = [];
  const placed = [];
  [...items].sort((a, b) => a.start - b.start).forEach((it) => {
    let r = rows.findIndex((end) => end + gapYears <= it.start);
    if (r === -1) { r = rows.length; rows.push(it.end); }
    else rows[r] = it.end;
    placed.push({ ...it, row: r });
  });
  return { placed, rowCount: rows.length };
}

function bracePath(w, h) {
  const m = w / 2, r = Math.min(14, w / 4), ym = h * 0.55;
  return `M0,${h} Q0,${ym} ${r},${ym} L${Math.max(r, m - r)},${ym} Q${m},${ym} ${m},0 Q${m},${ym} ${Math.min(w - r, m + r)},${ym} L${w - r},${ym} Q${w},${ym} ${w},${h}`;
}

function pickStep(ppy) {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500];
  for (const s of steps) if (s * ppy >= 76) return s;
  return 500;
}

function relationTo(p, f, byId) {
  if (!f || p.id === f.id) return "";
  if (p.id === f.fatherId) return "father";
  if (p.id === f.motherId) return "mother";
  if ((f.spouseIds || []).includes(p.id)) return "spouse";
  if (p.fatherId === f.id || p.motherId === f.id) return "child";
  if ((p.fatherId && p.fatherId === f.fatherId) || (p.motherId && p.motherId === f.motherId)) return "sibling";
  const fF = byId[f.fatherId], fM = byId[f.motherId];
  if ((fF && (p.id === fF.fatherId || p.id === fF.motherId)) || (fM && (p.id === fM.fatherId || p.id === fM.motherId))) return "grandparent";
  const pF = byId[p.fatherId], pM = byId[p.motherId];
  if ((pF && (pF.fatherId === f.id || pF.motherId === f.id)) || (pM && (pM.fatherId === f.id || pM.motherId === f.id))) return "grandchild";
  return "relative";
}

/* ---------------- GEDCOM ---------------- */

function exportGedcom(people) {
  const L = ["0 HEAD", "1 SOUR MERIDIAN", "1 GEDC", "2 VERS 5.5.1", "2 FORM LINEAGE-LINKED", "1 CHAR UTF-8"];
  const famKey = (f, m) => `${f || ""}|${m || ""}`;
  const fams = new Map();
  people.forEach((p) => {
    if (p.fatherId || p.motherId) {
      const k = famKey(p.fatherId, p.motherId);
      if (!fams.has(k)) fams.set(k, { husb: p.fatherId, wife: p.motherId, chil: [] });
      fams.get(k).chil.push(p.id);
    }
  });
  people.forEach((p) => (p.spouseIds || []).forEach((s) => {
    const a = p.sex === "F" ? s : p.id, b = p.sex === "F" ? p.id : s;
    const k = famKey(a, b);
    if (!fams.has(k)) fams.set(k, { husb: a, wife: b, chil: [] });
  }));
  const famIds = new Map([...fams.keys()].map((k, i) => [k, `F${i + 1}`]));
  people.forEach((p) => {
    const parts = p.name.replace(/\s*\(b\..*\)$/, "").trim().split(" ");
    const surname = parts.pop() || "";
    L.push(`0 @${p.id.toUpperCase()}@ INDI`, `1 NAME ${parts.join(" ")} /${surname}/`, `1 SEX ${p.sex || "U"}`);
    if (p.birth?.year) { L.push("1 BIRT", `2 DATE ${p.birth.year}`); if (p.birth.place) L.push(`2 PLAC ${p.birth.place}`); }
    if (p.death?.year) { L.push("1 DEAT", `2 DATE ${p.death.year}`); if (p.death.place) L.push(`2 PLAC ${p.death.place}`); }
    const k = famKey(p.fatherId, p.motherId);
    if ((p.fatherId || p.motherId) && famIds.has(k)) L.push(`1 FAMC @${famIds.get(k)}@`);
    fams.forEach((f, kk) => { if (f.husb === p.id || f.wife === p.id) L.push(`1 FAMS @${famIds.get(kk)}@`); });
  });
  fams.forEach((f, k) => {
    L.push(`0 @${famIds.get(k)}@ FAM`);
    if (f.husb) L.push(`1 HUSB @${f.husb.toUpperCase()}@`);
    if (f.wife) L.push(`1 WIFE @${f.wife.toUpperCase()}@`);
    f.chil.forEach((c) => L.push(`1 CHIL @${c.toUpperCase()}@`));
  });
  L.push("0 TRLR");
  return L.join("\n");
}

function parseGedcom(text) {
  const out = [];
  let cur = null, ctx = null;
  text.split(/\r?\n/).forEach((line) => {
    const m = line.match(/^(\d+)\s+(@[^@]+@\s+)?(\S+)(\s+(.*))?$/);
    if (!m) return;
    const lvl = +m[1], xref = m[2]?.trim().replace(/@/g, ""), tag = m[3], val = m[5] || "";
    if (lvl === 0) {
      if (cur) out.push(cur);
      cur = tag === "INDI" ? { id: "imp_" + (xref || out.length), name: "Unnamed", sex: "U", birth: {}, death: {}, events: [], periods: [], groups: [], spouseIds: [] } : null;
      ctx = null;
    } else if (cur) {
      if (tag === "NAME") cur.name = val.replace(/\//g, "").trim() || cur.name;
      else if (tag === "SEX") cur.sex = val.trim();
      else if (tag === "BIRT" || tag === "DEAT") ctx = tag;
      else if (tag === "DATE" && ctx) {
        const y = val.match(/\d{4}/);
        if (y) cur[ctx === "BIRT" ? "birth" : "death"].year = +y[0];
      } else if (tag === "PLAC" && ctx) cur[ctx === "BIRT" ? "birth" : "death"].place = val;
      else if (lvl === 1) ctx = null;
    }
  });
  if (cur) out.push(cur);
  return out.filter((p) => p.birth?.year);
}

/* ---------------- lane sub-components ---------------- */

function PeriodBar({ p, x, ppy, color, top }) {
  const w = Math.max(2, (p.end - p.start) * ppy);
  return (
    <div title={`${p.label} · ${p.start}–${p.end}`} style={{
      position: "absolute", left: x(p.start), top, width: w, height: 13,
      background: hexA(color, 0.16), border: `1px solid ${hexA(color, 0.6)}`, borderRadius: 3,
      font: "600 9.5px Archivo, sans-serif", color: C.ink, lineHeight: "12px",
      padding: "0 5px", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
    }}>{w > 44 ? p.label : ""}</div>
  );
}

function EventDot({ e, x, color, cy, showLabel, labelRow, onHover, onLeave }) {
  const px = x(e.year);
  return (
    <React.Fragment>
      <div onMouseEnter={(ev) => onHover(ev, [`${e.label}`, `${e.year}`])} onMouseLeave={onLeave}
        style={{ position: "absolute", left: px - 4, top: cy - 4, width: 8, height: 8, transform: "rotate(45deg)", background: C.paperHi, border: `1.6px solid ${color}`, zIndex: 3, cursor: "default" }} />
      {showLabel && (
        <div style={{ position: "absolute", left: px + 6, top: cy + 7 + labelRow * 13, font: "500 9.5px Archivo, sans-serif", color: C.inkSoft, whiteSpace: "nowrap", zIndex: 2 }}>
          <span style={{ font: "500 9px 'IBM Plex Mono', monospace", color, marginRight: 3 }}>{e.year}</span>{e.label}
        </div>
      )}
    </React.Fragment>
  );
}

function Brace({ a, x, ppy, onDelete }) {
  const w = Math.max(18, (a.end - a.start) * ppy);
  return (
    <div style={{ position: "absolute", left: x(a.start), top: 3, width: w, zIndex: 6 }}>
      <div title={a.note} style={{ font: "italic 500 10px Fraunces, Georgia, serif", color: C.focus, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: Math.max(w, 220), marginBottom: 1 }}>
        ❧ {a.note}
        <span onClick={onDelete} title="Remove research note" style={{ cursor: "pointer", marginLeft: 5, color: C.inkSoft, fontStyle: "normal" }}>×</span>
      </div>
      <svg width={w} height={11} style={{ display: "block", overflow: "visible" }}>
        <path d={bracePath(w, 11)} fill="none" stroke={C.focus} strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function PersonLane({ person, color, height, x, ppy, viewRange, crosshairYear, annotations, onDeleteAnn, onHover, onLeave }) {
  const braceZone = 30;
  const lifeY = height - 46;
  const { placed } = useMemo(() => packRows(person.periods || []), [person]);
  const visible = (s, e) => e >= viewRange[0] && s <= viewRange[1];
  const showLabels = ppy >= 4.5;
  const lifeEnd = person.death?.year || new Date().getFullYear();
  const events = useMemo(() => [...(person.events || [])].sort((a, b) => a.year - b.year), [person]);

  return (
    <React.Fragment>
      {(person.groups || []).filter((g) => visible(g.start, g.end)).map((g, i) => (
        <div key={"g" + i} style={{
          position: "absolute", left: x(g.start), top: braceZone - 4, width: Math.max(4, (g.end - g.start) * ppy),
          height: height - braceZone - 6, border: `1px dashed ${hexA(color, 0.5)}`, background: hexA(color, 0.05), borderRadius: 4, zIndex: 0,
        }}>
          <span style={{ position: "absolute", top: -1, left: 6, font: "700 8.5px Archivo, sans-serif", letterSpacing: ".08em", textTransform: "uppercase", color: hexA(color, 0.85), background: C.paper, padding: "0 4px", transform: "translateY(-55%)" }}>{g.label}</span>
        </div>
      ))}

      {person.birth?.year && visible(person.birth.year, lifeEnd) && (
        <div title={`${person.name} · ${person.birth.year}–${person.death?.year || "…"}`} style={{
          position: "absolute", left: x(person.birth.year), top: lifeY, width: Math.max(2, (lifeEnd - person.birth.year) * ppy), height: 6, borderRadius: 3, zIndex: 1,
          background: person.death?.year ? hexA(color, 0.75) : `linear-gradient(90deg, ${hexA(color, 0.75)}, ${hexA(color, 0)})`,
        }} />
      )}
      {person.birth?.year && (
        <div onMouseEnter={(ev) => onHover(ev, [`Born ${person.birth.year}`, person.birth.place || ""])} onMouseLeave={onLeave}
          style={{ position: "absolute", left: x(person.birth.year) - 5, top: lifeY - 2.5, width: 10, height: 10, borderRadius: "50%", background: C.paperHi, border: `2px solid ${color}`, zIndex: 3 }} />
      )}
      {person.death?.year && (
        <div onMouseEnter={(ev) => onHover(ev, [`Died ${person.death.year}`, person.death.place || ""])} onMouseLeave={onLeave}
          style={{ position: "absolute", left: x(person.death.year) - 4, top: lifeY - 2, width: 9, height: 9, background: color, zIndex: 3 }} />
      )}

      {placed.filter((p) => visible(p.start, p.end)).map((p, i) => (
        <PeriodBar key={"p" + i} p={p} x={x} ppy={ppy} color={color} top={braceZone + 4 + p.row * 17} />
      ))}

      {events.filter((e) => visible(e.year, e.year)).map((e, i) => (
        <EventDot key={"e" + i} e={e} x={x} color={color} cy={lifeY + 3} showLabel={showLabels} labelRow={i % 2} onHover={onHover} onLeave={onLeave} />
      ))}

      {annotations.filter((a) => visible(a.start, a.end)).map((a) => (
        <Brace key={a.id} a={a} x={x} ppy={ppy} onDelete={() => onDeleteAnn(a.id)} />
      ))}

      {crosshairYear != null && person.birth?.year && crosshairYear >= person.birth.year && crosshairYear <= lifeEnd && (
        <div style={{ position: "absolute", left: x(crosshairYear) + 7, top: lifeY - 22, background: C.ink, color: C.paperHi, font: "500 10px 'IBM Plex Mono', monospace", padding: "1px 5px", borderRadius: 2, zIndex: 8, pointerEvents: "none" }}>
          {Math.floor(crosshairYear - person.birth.year)}
        </div>
      )}
    </React.Fragment>
  );
}

function ContextLane({ lane, x, ppy, viewRange, focusLife, onHover, onLeave }) {
  const visible = (s, e) => e >= viewRange[0] && s <= viewRange[1];
  const dim = (s, e) => (focusLife && e >= focusLife[0] && s <= focusLife[1] ? 1 : 0.38);
  const showLabels = ppy >= 3.4;
  const { placed } = useMemo(() => packRows(lane.periods || [], 2), [lane]);
  return (
    <React.Fragment>
      {placed.filter((p) => visible(p.start, p.end)).map((p, i) => (
        <div key={"p" + i} title={`${p.label} · ${p.start}–${p.end}`} style={{
          position: "absolute", left: x(p.start), top: 6 + p.row * 15, width: Math.max(2, (p.end - p.start) * ppy), height: 12,
          background: hexA(C.slate, 0.18), borderLeft: `2px solid ${C.slate}`, borderRight: `2px solid ${C.slate}`,
          font: "600 9px Archivo, sans-serif", color: C.inkSoft, lineHeight: "12px", padding: "0 4px",
          overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", opacity: dim(p.start, p.end),
        }}>{(p.end - p.start) * ppy > 50 ? p.label : ""}</div>
      ))}
      {(lane.events || []).filter((e) => visible(e.year, e.year)).map((e, i) => (
        <React.Fragment key={"e" + i}>
          <div onMouseEnter={(ev) => onHover(ev, [e.label, String(e.year)])} onMouseLeave={onLeave}
            style={{ position: "absolute", left: x(e.year) - 3, top: CTX_H - 17, width: 6, height: 6, borderRadius: "50%", background: C.slate, opacity: dim(e.year, e.year), zIndex: 2 }} />
          {showLabels && (
            <div style={{ position: "absolute", left: x(e.year) + 6, top: CTX_H - 21, font: "500 9px Archivo, sans-serif", color: C.inkSoft, whiteSpace: "nowrap", opacity: dim(e.year, e.year) }}>
              <span style={{ font: "500 8.5px 'IBM Plex Mono', monospace", color: C.slate, marginRight: 3 }}>{e.year}</span>{e.label}
            </div>
          )}
        </React.Fragment>
      ))}
    </React.Fragment>
  );
}

/* ---------------- main app ---------------- */

export default function App() {
  const {
    projectList, project, isDirty, isLoading,
    openProject, createProject, deleteProject, renameProject,
    addSource, deleteSource,
    setPeople, setAnnotations, setFocusId, setRelativeIds, setView, setCtxOn,
  } = useProject(storage);

  // Derive working state from project (fallbacks keep UI stable during load)
  const people = project?.people ?? SAMPLE_PEOPLE;
  const annotations = project?.annotations ?? SAMPLE_ANNOTATIONS;
  const focusId = project?.settings?.focusPersonId ?? people[0]?.id ?? "i1";
  const relativeIds = project?.settings?.relativeIds ?? [];
  const view = project?.settings?.view ?? { left: 1842, ppy: 8 };
  const ctxOn = project?.settings?.ctxOn ?? { local: true, national: true, global: true };
  const sources = project?.sources ?? [];

  // UI-only state (not persisted)
  const [research, setResearch] = useState(false);
  const [trackW, setTrackW] = useState(0);
  const [crosshair, setCrosshair] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  const [draft, setDraft] = useState(null);
  const [noteModal, setNoteModal] = useState(null);
  const [noteText, setNoteText] = useState("");
  const [addRelOpen, setAddRelOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [projectManagerOpen, setProjectManagerOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  const contentRef = useRef(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const dragRef = useRef(null);
  const fileRef = useRef(null);
  const initRef = useRef(false);

  const byId = useMemo(() => Object.fromEntries(people.map((p) => [p.id, p])), [people]);
  const focus = byId[focusId] || people[0];
  const relatives = relativeIds.map((id) => byId[id]).filter(Boolean);
  const ctxLanes = CONTEXT_LANES.filter((l) => ctxOn[l.id]);

  const x = (year) => (year - view.left) * view.ppy;
  const yearAt = (px) => view.left + px / view.ppy;
  const viewRange = [view.left, view.left + trackW / view.ppy];
  const focusLife = focus?.birth?.year ? [focus.birth.year, focus.death?.year || 2026] : null;

  /* sizing — depends on isLoading so the observer attaches after the content div mounts */
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    setTrackW(el.clientWidth - HEADER_W);
    const ro = new ResizeObserver(() => setTrackW(el.clientWidth - HEADER_W));
    ro.observe(el);
    return () => ro.disconnect();
  }, [isLoading]);

  /* initial view fit — only when ppy is still default (8) */
  useEffect(() => {
    if (trackW > 0 && project && !initRef.current) {
      initRef.current = true;
      if ((project.settings?.view?.ppy ?? 8) === 8) {
        fitRange(1842, 1996);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackW, project]);

  function fitRange(a, b) {
    const w = contentRef.current ? contentRef.current.clientWidth - HEADER_W : trackW;
    if (w <= 0) return;
    const ppy = clamp(w / (b - a), 0.3, 300);
    setView({ left: a, ppy });
  }
  const fitFocus = () => {
    if (!focus?.birth?.year) return;
    const b = focus.birth.year, d = focus.death?.year || 2026, pad = Math.max(6, (d - b) * 0.12);
    fitRange(b - pad, d + pad);
  };
  const fitAll = () => {
    const ys = people.flatMap((p) => [p.birth?.year, p.death?.year]).filter(Boolean);
    if (ys.length === 0) return;
    fitRange(Math.min(...ys) - 8, Math.max(...ys, 1995) + 8);
  };
  const zoomAt = (mx, factor) => {
    const v = viewRef.current;
    const yr = v.left + mx / v.ppy;
    const ppy = clamp(v.ppy * factor, 0.3, 300);
    setView({ left: yr - mx / ppy, ppy });
  };

  /* wheel zoom (native, non-passive) */
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const onWheel = (e) => {
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left - HEADER_W;
      if (mx < 0) return;
      e.preventDefault();
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        setView((v) => ({ ...v, left: v.left + e.deltaX / v.ppy }));
      } else {
        zoomAt(mx, Math.exp(-e.deltaY * 0.0016));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* pointer: pan / research-drag / crosshair */
  const onPointerDown = (e) => {
    const rect = contentRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left - HEADER_W;
    if (mx < 0 || e.button !== 0) return;
    const laneEl = e.target.closest && e.target.closest("[data-lane]");
    if (research && laneEl) {
      dragRef.current = { kind: "ann", laneKey: laneEl.dataset.lane, startYear: yearAt(mx) };
      setDraft({ laneKey: laneEl.dataset.lane, start: yearAt(mx), end: yearAt(mx) });
    } else {
      dragRef.current = { kind: "pan", startX: e.clientX, startLeft: view.left };
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    const rect = contentRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left - HEADER_W;
    if (mx >= 0) setCrosshair({ px: mx, year: yearAt(mx) });
    else setCrosshair(null);
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === "pan") {
      setView((v) => ({ ...v, left: d.startLeft - (e.clientX - d.startX) / v.ppy }));
    } else if (d.kind === "ann") {
      setDraft({ laneKey: d.laneKey, start: Math.min(d.startYear, yearAt(mx)), end: Math.max(d.startYear, yearAt(mx)) });
    }
  };
  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.kind === "ann" && draft && draft.end - draft.start > 0.15) {
      setNoteModal({ ...draft, start: Math.round(draft.start * 2) / 2, end: Math.round(draft.end * 2) / 2 });
      setNoteText("");
    }
    setDraft(null);
  };

  const showTip = (e, lines) => setTooltip({ x: e.clientX, y: e.clientY, lines: lines.filter(Boolean) });
  const hideTip = () => setTooltip(null);
  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3500); };

  /* GEDCOM */
  const doExport = () => {
    const blob = new Blob([exportGedcom(people)], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${project?.name ?? "family-atlas"}.ged`;
    a.click();
    URL.revokeObjectURL(a.href);
    flash("Exported GEDCOM 5.5.1");
  };
  const doImport = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const imported = parseGedcom(String(r.result));
      if (!imported.length) return flash("No individuals with dates found in that file.");
      setPeople((ps) => [...ps, ...imported.filter((p) => !ps.some((q) => q.id === p.id))]);
      flash(`Imported ${imported.length} people — add them from "+ relative".`);
    };
    r.readAsText(f);
    e.target.value = "";
  };

  /* ticks */
  const ticks = useMemo(() => {
    if (trackW <= 0) return { major: [], minor: [] };
    const step = pickStep(view.ppy);
    const sub = step / 5;
    const right = view.left + trackW / view.ppy;
    const major = [], minor = [];
    for (let y = Math.floor(view.left / step) * step; y <= right; y += step) major.push(y);
    if (sub * view.ppy >= 13) for (let y = Math.floor(view.left / sub) * sub; y <= right; y += sub) if (y % step !== 0) minor.push(y);
    return { major, minor };
  }, [view, trackW]);

  const ctxAreaH = ctxLanes.length * CTX_H;
  const laneFor = (key) => annotations.filter((a) => a.laneKey === key);
  const relColor = (i) => C.rel[i % C.rel.length];

  const promote = (id) => {
    setRelativeIds((r) => [focusId, ...r.filter((q) => q !== id && q !== focusId)]);
    setFocusId(id);
  };

  const headerCell = (children, h, area) => (
    <div style={{ width: HEADER_W, minWidth: HEADER_W, height: h, borderRight: `1.5px solid ${C.ink}`, borderBottom: `1px solid ${C.rule}`, padding: "7px 12px", boxSizing: "border-box", position: "relative", background: C.paper, zIndex: 10 }}>
      {area && <div style={{ font: "700 8px Archivo, sans-serif", letterSpacing: ".18em", color: hexA(C.ink, 0.45), textTransform: "uppercase", marginBottom: 3 }}>{area}</div>}
      {children}
    </div>
  );

  const track = (key, h, children) => (
    <div data-lane={key} style={{ flex: 1, height: h, position: "relative", overflow: "hidden", borderBottom: `1px solid ${C.rule}`, boxSizing: "border-box", cursor: research ? "crosshair" : "grab" }}>
      {draft && draft.laneKey === key && (
        <div style={{ position: "absolute", left: x(draft.start), width: Math.max(1, (draft.end - draft.start) * view.ppy), top: 0, bottom: 0, background: hexA(C.focus, 0.12), borderLeft: `1px dashed ${C.focus}`, borderRight: `1px dashed ${C.focus}`, zIndex: 9, pointerEvents: "none" }} />
      )}
      {children}
    </div>
  );

  /* loading state */
  if (isLoading) {
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.paper, color: C.inkSoft, font: "500 13px Archivo, sans-serif" }}>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,700;1,9..144,500&family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" />
        Loading project…
      </div>
    );
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: C.paper, color: C.ink, fontFamily: "Archivo, system-ui, sans-serif", overflow: "hidden" }}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,700;1,9..144,500&family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" />

      {/* ------- toolbar ------- */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: `1.5px solid ${C.ink}`, flexWrap: "wrap", background: C.paper }}>

        {/* Brand + project name */}
        <div style={{ marginRight: 6 }}>
          <div style={{ font: "700 19px Fraunces, Georgia, serif", letterSpacing: ".01em", lineHeight: 1 }}>Meridian</div>
          <div style={{ font: "500 9px Archivo, sans-serif", letterSpacing: ".22em", textTransform: "uppercase", color: C.inkSoft }}>family time atlas</div>
        </div>

        <button
          onClick={() => setProjectManagerOpen(true)}
          title="Manage projects"
          style={{
            font: "600 12px Fraunces, Georgia, serif", color: C.ink,
            background: "none", border: `1px solid ${C.rule}`,
            borderRadius: 3, padding: "4px 8px", cursor: "pointer",
            display: "flex", alignItems: "center", gap: 4,
            maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}
        >
          {project?.name ?? "…"}
          {isDirty && <span style={{ color: C.focus, fontSize: 10, flexShrink: 0 }}>●</span>}
        </button>

        <span style={{ width: 1, height: 22, background: C.rule }} />

        <label style={{ font: "600 11px Archivo, sans-serif", color: C.inkSoft }}>Focus</label>
        <select value={focusId} onChange={(e) => { setFocusId(e.target.value); setRelativeIds((r) => r.filter((q) => q !== e.target.value)); }}
          style={{ font: "600 12px Archivo, sans-serif", background: C.paperHi, color: C.ink, border: `1px solid ${C.ink}`, borderRadius: 3, padding: "4px 6px" }}>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <button style={btnStyle(false)} onClick={() => setAddRelOpen(true)}>+ relative</button>
        <button style={btnStyle(research)} onClick={() => setResearch((r) => !r)} title="Drag across any lane to mark a period for investigation">
          {research ? "✓ research mode" : "❧ research mode"}
        </button>

        <span style={{ flex: 1 }} />

        <label style={{ font: "600 11px Archivo, sans-serif", color: C.inkSoft }}>Context source</label>
        <select defaultValue="sample" style={{ font: "600 12px Archivo, sans-serif", background: C.paperHi, color: C.ink, border: `1px solid ${C.ink}`, borderRadius: 3, padding: "4px 6px" }}>
          <option value="sample">Built-in sample</option>
          <option disabled>Wikidata — coming soon</option>
          <option disabled>time.graphics — coming soon</option>
        </select>

        <button style={btnStyle(false)} onClick={() => fileRef.current?.click()}>Import GEDCOM</button>
        <input ref={fileRef} type="file" accept=".ged,.gedcom,.txt" onChange={doImport} style={{ display: "none" }} />
        <button style={btnStyle(false)} onClick={doExport}>Export GEDCOM</button>

        <button
          style={{ ...btnStyle(sourcesOpen), position: "relative" }}
          onClick={() => setSourcesOpen((o) => !o)}
          title="Research sources — documents, images, links"
        >
          Sources{sources.length > 0 ? ` (${sources.length})` : ""}
        </button>

        <span style={{ width: 1, height: 22, background: C.rule }} />
        <button style={btnStyle(false)} onClick={() => zoomAt(trackW / 2, 1.45)}>+</button>
        <button style={btnStyle(false)} onClick={() => zoomAt(trackW / 2, 1 / 1.45)}>−</button>
        <button style={btnStyle(false)} onClick={fitFocus}>Fit life</button>
        <button style={btnStyle(false)} onClick={fitAll}>All</button>
      </div>

      {/* ------- board ------- */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", position: "relative" }}>
        <div ref={contentRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          onPointerLeave={() => { setCrosshair(null); }}
          style={{ position: "relative", minHeight: "100%", touchAction: "none", userSelect: "none" }}>

          {/* grid underlay */}
          <div style={{ position: "absolute", top: 0, bottom: 0, left: HEADER_W, right: 0, zIndex: 0, pointerEvents: "none" }}>
            {focusLife && (
              <div style={{ position: "absolute", left: x(focusLife[0]), width: Math.max(0, (focusLife[1] - focusLife[0]) * view.ppy), top: 0, height: ctxAreaH, background: hexA(C.focus, 0.06), borderLeft: `1px solid ${hexA(C.focus, 0.25)}`, borderRight: `1px solid ${hexA(C.focus, 0.25)}` }} />
            )}
            {ticks.minor.map((y) => <div key={"m" + y} style={{ position: "absolute", left: x(y), top: 0, bottom: 0, width: 1, background: C.ruleFaint }} />)}
            {ticks.major.map((y) => <div key={"M" + y} style={{ position: "absolute", left: x(y), top: 0, bottom: 0, width: 1, background: y % 100 === 0 ? hexA(C.ink, 0.35) : C.rule }} />)}
          </div>

          {/* context lanes */}
          {ctxLanes.map((lane, i) => (
            <div key={lane.id} style={{ display: "flex", position: "relative", zIndex: 1 }}>
              {headerCell(
                <React.Fragment>
                  <div style={{ font: "700 13px Fraunces, Georgia, serif" }}>{lane.label}</div>
                  <div style={{ font: "500 9.5px Archivo, sans-serif", color: C.inkSoft }}>{lane.sub}</div>
                </React.Fragment>, CTX_H, i === 0 ? "Context" : null
              )}
              {track("ctx:" + lane.id, CTX_H,
                <ContextLane lane={lane} x={x} ppy={view.ppy} viewRange={viewRange} focusLife={focusLife} onHover={showTip} onLeave={hideTip} />
              )}
            </div>
          ))}

          {/* axis */}
          <div style={{ display: "flex", position: "relative", zIndex: 1 }}>
            <div style={{ width: HEADER_W, minWidth: HEADER_W, height: AXIS_H, borderRight: `1.5px solid ${C.ink}`, borderTop: `1.5px solid ${C.ink}`, borderBottom: `1.5px solid ${C.ink}`, background: C.ink, color: C.paperHi, font: "700 9px Archivo, sans-serif", letterSpacing: ".2em", textTransform: "uppercase", display: "flex", alignItems: "center", padding: "0 12px", boxSizing: "border-box" }}>
              Years
            </div>
            <div style={{ flex: 1, height: AXIS_H, position: "relative", overflow: "hidden", borderTop: `1.5px solid ${C.ink}`, borderBottom: `1.5px solid ${C.ink}`, background: hexA(C.ink, 0.04), boxSizing: "border-box" }}>
              {ticks.major.map((y) => (
                <div key={y} style={{ position: "absolute", left: x(y) + 4, top: 8, font: `${y % 100 === 0 ? 600 : 400} 11px 'IBM Plex Mono', monospace`, color: C.ink }}>{y}</div>
              ))}
            </div>
          </div>

          {/* focus lane */}
          <div style={{ display: "flex", position: "relative", zIndex: 1, background: hexA(C.focus, 0.035) }}>
            {focus ? (
              <>
                {headerCell(
                  <React.Fragment>
                    <div style={{ font: "700 14px Fraunces, Georgia, serif", color: C.focus }}>{focus.name}</div>
                    <div style={{ font: "500 10px 'IBM Plex Mono', monospace", color: C.inkSoft }}>{focus.birth?.year}–{focus.death?.year || "…"}</div>
                    <div style={{ position: "absolute", bottom: 7, left: 12, font: "700 8.5px Archivo, sans-serif", letterSpacing: ".12em", color: C.paperHi, background: C.focus, padding: "2px 6px", borderRadius: 2 }}>FOCUS</div>
                  </React.Fragment>, FOCUS_H, "Focus"
                )}
                {track("p:" + focus.id, FOCUS_H,
                  <PersonLane person={focus} color={C.focus} height={FOCUS_H} x={x} ppy={view.ppy} viewRange={viewRange}
                    crosshairYear={crosshair?.year} annotations={laneFor("p:" + focus.id)}
                    onDeleteAnn={(id) => setAnnotations((a) => a.filter((q) => q.id !== id))} onHover={showTip} onLeave={hideTip} />
                )}
              </>
            ) : (
              <>
                {headerCell(<div style={{ font: "700 8.5px Archivo, sans-serif", letterSpacing: ".12em", color: C.paperHi, background: C.focus, padding: "2px 6px", borderRadius: 2, display: "inline-block" }}>FOCUS</div>, FOCUS_H, "Focus")}
                <div style={{ flex: 1, display: "flex", alignItems: "center", padding: "0 20px", font: "italic 500 13px Fraunces, Georgia, serif", color: C.inkSoft, borderBottom: `1px solid ${C.rule}` }}>
                  Import a GEDCOM or add people to start building the timeline.
                </div>
              </>
            )}
          </div>

          {/* compare lanes */}
          {relatives.map((p, i) => (
            <div key={p.id} style={{ display: "flex", position: "relative", zIndex: 1 }}>
              {headerCell(
                <React.Fragment>
                  <div style={{ font: "600 12.5px Fraunces, Georgia, serif", color: relColor(i) }}>{p.name}</div>
                  <div style={{ font: "500 10px 'IBM Plex Mono', monospace", color: C.inkSoft }}>
                    {p.birth?.year}–{p.death?.year || "…"}
                    <span style={{ font: "italic 500 10.5px Fraunces, Georgia, serif", marginLeft: 6 }}>{relationTo(p, focus, byId)}</span>
                  </div>
                  <div style={{ position: "absolute", bottom: 6, left: 12, display: "flex", gap: 6 }}>
                    <button style={{ ...btnStyle(false), padding: "1px 6px", fontSize: 10 }} onClick={() => promote(p.id)} title="Make this person the focus">⌖ focus</button>
                    <button style={{ ...btnStyle(false), padding: "1px 6px", fontSize: 10 }} onClick={() => setRelativeIds((r) => r.filter((q) => q !== p.id))} title="Remove lane">×</button>
                  </div>
                </React.Fragment>, REL_H, i === 0 ? "Compare" : null
              )}
              {track("p:" + p.id, REL_H,
                <PersonLane person={p} color={relColor(i)} height={REL_H} x={x} ppy={view.ppy} viewRange={viewRange}
                  crosshairYear={crosshair?.year} annotations={laneFor("p:" + p.id)}
                  onDeleteAnn={(id) => setAnnotations((a) => a.filter((q) => q.id !== id))} onHover={showTip} onLeave={hideTip} />
              )}
            </div>
          ))}

          {relatives.length === 0 && (
            <div style={{ display: "flex" }}>
              {headerCell(<div style={{ font: "500 10px Archivo, sans-serif", color: C.inkSoft }}>No comparison lanes</div>, 64, "Compare")}
              <div style={{ flex: 1, display: "flex", alignItems: "center", padding: "0 16px", font: "italic 500 12px Fraunces, Georgia, serif", color: C.inkSoft, borderBottom: `1px solid ${C.rule}` }}>
                Add a relative to lay their life against {focus?.name?.split(" ")[0]}'s years.
              </div>
            </div>
          )}

          {/* crosshair */}
          {crosshair && (
            <div style={{ position: "absolute", top: 0, bottom: 0, left: HEADER_W, right: 0, zIndex: 20, pointerEvents: "none" }}>
              <div style={{ position: "absolute", left: crosshair.px, top: 0, bottom: 0, width: 1, background: hexA(C.ink, 0.55) }} />
              <div style={{ position: "absolute", left: crosshair.px + 6, top: ctxAreaH + 7, background: C.focus, color: C.paperHi, font: "600 11px 'IBM Plex Mono', monospace", padding: "1px 6px", borderRadius: 2 }}>
                {Math.round(crosshair.year)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* status / hints */}
      <div style={{ borderTop: `1.5px solid ${C.ink}`, padding: "5px 14px", display: "flex", gap: 18, font: "500 10.5px Archivo, sans-serif", color: C.inkSoft, background: C.paper }}>
        <span>scroll · zoom</span><span>drag · pan</span>
        <span>{research ? "research mode: drag across a lane to mark a question" : "hover the board for the year & everyone's age"}</span>
        <span style={{ flex: 1 }} />
        <label style={{ display: "flex", gap: 10 }}>
          {CONTEXT_LANES.map((l) => (
            <span key={l.id} onClick={() => setCtxOn((c) => ({ ...c, [l.id]: !c[l.id] }))}
              style={{ cursor: "pointer", textDecoration: ctxOn[l.id] ? "none" : "line-through", color: ctxOn[l.id] ? C.ink : C.inkSoft }}>
              {l.label.toLowerCase()}
            </span>
          ))}
        </label>
      </div>

      {/* tooltip */}
      {tooltip && (
        <div style={{ position: "fixed", left: tooltip.x + 12, top: tooltip.y + 12, zIndex: 200, background: C.ink, color: C.paperHi, padding: "6px 9px", borderRadius: 3, pointerEvents: "none", maxWidth: 260, boxShadow: "0 6px 18px rgba(20,28,24,.3)" }}>
          {tooltip.lines.map((l, i) => (
            <div key={i} style={{ font: i === 0 ? "600 11.5px Archivo, sans-serif" : "400 10.5px 'IBM Plex Mono', monospace", opacity: i === 0 ? 1 : 0.8 }}>{l}</div>
          ))}
        </div>
      )}

      {/* note modal */}
      {noteModal && (
        <Modal title={`Research note · ${noteModal.start}–${noteModal.end}`} onClose={() => setNoteModal(null)}>
          <textarea autoFocus value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={3}
            placeholder="What needs investigating in this period? Sources to check, hypotheses, gaps…"
            style={{ width: "100%", boxSizing: "border-box", font: "500 12px Archivo, sans-serif", color: C.ink, background: "#fff", border: `1px solid ${C.ink}`, borderRadius: 3, padding: 8, resize: "vertical" }} />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
            <button style={btnStyle(false)} onClick={() => setNoteModal(null)}>Cancel</button>
            <button style={btnStyle(true)} onClick={() => {
              if (noteText.trim()) {
                setAnnotations((a) => [...a, { id: "a" + Date.now(), laneKey: noteModal.laneKey, start: noteModal.start, end: noteModal.end, note: noteText.trim() }]);
              }
              setNoteModal(null);
            }}>Save note</button>
          </div>
        </Modal>
      )}

      {/* add relative modal */}
      {addRelOpen && (
        <Modal title="Add a comparison lane" onClose={() => setAddRelOpen(false)}>
          <div style={{ maxHeight: 300, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
            {people.filter((p) => p.id !== focusId && !relativeIds.includes(p.id)).map((p) => (
              <button key={p.id} onClick={() => { setRelativeIds((r) => [...r, p.id]); setAddRelOpen(false); }}
                style={{ ...btnStyle(false), textAlign: "left", display: "flex", justifyContent: "space-between", gap: 10 }}>
                <span>{p.name} <em style={{ font: "italic 500 10.5px Fraunces, Georgia, serif", color: C.inkSoft }}>{relationTo(p, focus, byId)}</em></span>
                <span style={{ font: "400 11px 'IBM Plex Mono', monospace", color: C.inkSoft }}>{p.birth?.year}–{p.death?.year || "…"}</span>
              </button>
            ))}
            {people.filter((p) => p.id !== focusId && !relativeIds.includes(p.id)).length === 0 && (
              <div style={{ font: "500 12px Archivo, sans-serif", color: C.inkSoft }}>Everyone is already on the board. Import a GEDCOM to add more people.</div>
            )}
          </div>
        </Modal>
      )}

      {/* project manager */}
      {projectManagerOpen && (
        <ProjectManager
          projectList={projectList}
          currentProjectId={project?.id}
          onClose={() => setProjectManagerOpen(false)}
          onCreate={async (name) => { await createProject(name); setProjectManagerOpen(false); initRef.current = false; }}
          onOpen={(id) => { openProject(id); initRef.current = false; }}
          onDelete={deleteProject}
          onRename={(id, name) => { if (id === project?.id) renameProject(name); }}
        />
      )}

      {/* sources panel */}
      {sourcesOpen && (
        <SourcesPanel
          sources={sources}
          people={people}
          storage={storage}
          onAdd={addSource}
          onDelete={deleteSource}
          onClose={() => setSourcesOpen(false)}
        />
      )}

      {/* toast */}
      {toast && (
        <div style={{ position: "fixed", bottom: 46, left: 14, zIndex: 300, background: C.ink, color: C.paperHi, font: "600 12px Archivo, sans-serif", padding: "8px 12px", borderRadius: 3, boxShadow: "0 6px 18px rgba(20,28,24,.35)" }}>
          {toast}
        </div>
      )}
    </div>
  );
}
