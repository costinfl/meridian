import React, { useState, useRef, useEffect, useMemo } from "react";
import { C, hexA, clamp, btnStyle, EVENT_TYPES, eventType } from "./theme.js";
import { SAMPLE_PEOPLE, SAMPLE_ANNOTATIONS, SAMPLE_ERAS, CONTEXT_LANES } from "./sampleData.js";
import { createEvent, createPeriod, createGroup, createAnnotation, createEra, createMediaPin } from "./models/project.js";
import { exportGedcom, parseGedcom } from "./gedcom.js";
import { exportProjectZip, importProjectZip } from "./share.js";
import { storage } from "./storage/StorageService.js";
import { useProject } from "./hooks/useProject.js";
import { Modal } from "./components/Modal.jsx";
import { ItemModal } from "./components/ItemModal.jsx";
import { ProjectManager } from "./components/ProjectManager.jsx";
import { SourcesPanel } from "./components/SourcesPanel.jsx";

/* Stop a click on an interactive timeline item from starting a board pan/drag. */
const stopPD = (e) => e.stopPropagation();
const ARR_KEY = { event: "events", period: "periods", group: "groups", media: "media" };

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
const LIFE_TAIL = 44;

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

/* ---------------- lane sub-components ---------------- */

function PeriodBar({ p, x, ppy, color, top, onOpen }) {
  const w = Math.max(2, (p.end - p.start) * ppy);
  const c = p.color || color;
  return (
    <div onPointerDown={stopPD} onClick={onOpen} title={`${p.label} · ${p.start}–${p.end}${p.verified ? " ✓ verified" : ""}`} style={{
      position: "absolute", left: x(p.start), top, width: w, height: 13, cursor: "pointer",
      background: hexA(c, 0.16), border: `1px ${p.verified ? "solid" : "dashed"} ${hexA(c, 0.6)}`, borderRadius: 3,
      font: "600 9.5px Archivo, sans-serif", color: C.ink, lineHeight: "12px",
      padding: "0 5px", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
    }}>{w > 44 ? `${p.verified ? "✓ " : ""}${p.label}` : ""}</div>
  );
}

function EventDot({ e, x, color, cy, showLabel, labelRow, onHover, onLeave, onOpen }) {
  const px = x(e.year);
  const et = eventType(e.type);
  const c = e.color || et.color || color;
  return (
    <React.Fragment>
      <div onPointerDown={stopPD} onClick={onOpen} onMouseEnter={(ev) => onHover(ev, [`${et.icon} ${e.label}${e.verified ? " ✓" : ""}`, `${e.year} · ${et.label}`])} onMouseLeave={onLeave}
        style={{ position: "absolute", left: px - 5, top: cy - 5, width: 10, height: 10, transform: "rotate(45deg)", background: e.verified ? c : C.paperHi, border: `1.8px ${e.verified ? "solid" : "dashed"} ${hexA(c, e.verified ? 1 : 0.6)}`, zIndex: 3, cursor: "pointer" }} />
      {showLabel && (
        <div style={{ position: "absolute", left: px + 6, top: cy + 7 + labelRow * 13, font: "500 9.5px Archivo, sans-serif", color: C.inkSoft, whiteSpace: "nowrap", zIndex: 2 }}>
          <span style={{ font: "500 9px 'IBM Plex Mono', monospace", color: c, marginRight: 3 }}>{e.year}</span>{e.label}
        </div>
      )}
    </React.Fragment>
  );
}

function MediaPin({ m, x, source, storage, onOpen }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let dead = false, made = null;
    if (source?.blobKey && storage) {
      storage.loadBlob(source.blobKey).then((blob) => {
        if (!dead && blob && (source.type === "image" || blob.type?.startsWith("image/"))) {
          made = URL.createObjectURL(blob); setUrl(made);
        }
      }).catch(() => {});
    }
    return () => { dead = true; if (made) URL.revokeObjectURL(made); };
  }, [source, storage]);
  return (
    <div onPointerDown={stopPD} onClick={onOpen} title={source?.title || m.label || "Media"}
      style={{ position: "absolute", left: x(m.year) - 9, top: 4, width: 18, height: 18, borderRadius: 3, overflow: "hidden", zIndex: 4, cursor: "pointer",
        border: `1.5px solid ${m.color || C.slate}`, background: C.paperHi, display: "flex", alignItems: "center", justifyContent: "center", font: "11px" }}>
      {url ? <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "❏"}
    </div>
  );
}

function Brace({ a, x, ppy, research, onOpen, onDelete }) {
  const w = Math.max(18, (a.end - a.start) * ppy);
  const c = a.color || C.focus;
  return (
    <div style={{ position: "absolute", left: x(a.start), top: 3, width: w, zIndex: 6 }}>
      <div onPointerDown={stopPD} onClick={onOpen} title={a.note} style={{ font: "italic 500 10px Fraunces, Georgia, serif", color: c, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: Math.max(w, 220), marginBottom: 1, cursor: "pointer" }}>
        ❧ {a.title || a.note}
        {research && (
          <span onPointerDown={stopPD} onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Remove bracket" style={{ cursor: "pointer", marginLeft: 5, color: C.inkSoft, fontStyle: "normal" }}>×</span>
        )}
      </div>
      <svg width={w} height={11} style={{ display: "block", overflow: "visible" }}>
        <path d={bracePath(w, 11)} fill="none" stroke={c} strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function PersonLane({ person, color, height, x, ppy, viewRange, crosshairYear, annotations, sourcesById, storage, research, onOpenItem, onDeleteAnn, onHover, onLeave }) {
  const braceZone = 30;
  const lifeY = height - 46;
  const { placed } = useMemo(() => packRows(person.periods || []), [person]);
  const visible = (s, e) => e >= viewRange[0] && s <= viewRange[1];
  const showLabels = ppy >= 4.5;
  const lifeEnd = person.death?.year || new Date().getFullYear();
  const events = useMemo(() => [...(person.events || [])].sort((a, b) => a.year - b.year), [person]);
  const laneKey = "p:" + person.id;
  const open = (kind, item) => onOpenItem({ kind, item, laneKey, laneId: person.id });

  return (
    <React.Fragment>
      {(person.groups || []).filter((g) => visible(g.start, g.end)).map((g) => {
        const gc = g.color || color;
        return (
          <div key={g.id} style={{
            position: "absolute", left: x(g.start), top: braceZone - 4, width: Math.max(4, (g.end - g.start) * ppy),
            height: height - braceZone - 6, border: `1px dashed ${hexA(gc, 0.5)}`, background: hexA(gc, 0.05), borderRadius: 4, zIndex: 0,
          }}>
            <span onPointerDown={stopPD} onClick={() => open("group", g)} style={{ position: "absolute", top: -1, left: 6, font: "700 8.5px Archivo, sans-serif", letterSpacing: ".08em", textTransform: "uppercase", color: hexA(gc, 0.95), background: C.paper, padding: "0 4px", transform: "translateY(-55%)", cursor: "pointer", pointerEvents: "auto" }}>{g.verified ? "✓ " : ""}{g.label}</span>
          </div>
        );
      })}

      {person.birth?.year && visible(person.birth.year, lifeEnd) && (
        <div title={`${person.name} · ${person.birth.year}–${person.death?.year || "…"}`} style={{
          position: "absolute", left: x(person.birth.year), top: lifeY, width: Math.max(2, (lifeEnd - person.birth.year) * ppy), height: 6,
          borderRadius: person.death?.year ? 3 : "3px 0 0 3px", zIndex: 1, background: hexA(color, 0.75),
        }} />
      )}
      {!person.death?.year && person.birth?.year && visible(person.birth.year, lifeEnd) && (
        <div style={{
          position: "absolute", left: x(lifeEnd), top: lifeY, width: LIFE_TAIL, height: 6, borderRadius: "0 3px 3px 0", zIndex: 1,
          background: `linear-gradient(90deg, ${hexA(color, 0.75)}, ${hexA(color, 0)})`,
        }} />
      )}
      {person.birth?.year && (
        <div onPointerDown={stopPD} onClick={() => open("birth", person.birth)} onMouseEnter={(ev) => onHover(ev, [`Born ${person.birth.year}${person.birth.verified ? " ✓" : ""}`, person.birth.place || ""])} onMouseLeave={onLeave}
          style={{ position: "absolute", left: x(person.birth.year) - 5, top: lifeY - 2.5, width: 10, height: 10, borderRadius: "50%", background: C.paperHi, border: `2px ${person.birth.verified ? "solid" : "dashed"} ${color}`, zIndex: 3, cursor: "pointer" }} />
      )}
      {person.death?.year && (
        <div onPointerDown={stopPD} onClick={() => open("death", person.death)} onMouseEnter={(ev) => onHover(ev, [`Died ${person.death.year}${person.death.verified ? " ✓" : ""}`, person.death.place || ""])} onMouseLeave={onLeave}
          style={{ position: "absolute", left: x(person.death.year) - 4, top: lifeY - 2, width: 9, height: 9, background: person.death.verified ? color : C.paperHi, border: `1.5px ${person.death.verified ? "solid" : "dashed"} ${color}`, zIndex: 3, cursor: "pointer" }} />
      )}

      {placed.filter((p) => visible(p.start, p.end)).map((p) => (
        <PeriodBar key={p.id} p={p} x={x} ppy={ppy} color={color} top={braceZone + 4 + p.row * 17} onOpen={() => open("period", p)} />
      ))}

      {events.filter((e) => visible(e.year, e.year)).map((e, i) => (
        <EventDot key={e.id} e={e} x={x} color={color} cy={lifeY + 3} showLabel={showLabels} labelRow={i % 2} onHover={onHover} onLeave={onLeave} onOpen={() => open("event", e)} />
      ))}

      {(person.media || []).filter((m) => visible(m.year, m.year)).map((m) => (
        <MediaPin key={m.id} m={m} x={x} source={sourcesById[m.sourceId]} storage={storage} onOpen={() => open("media", m)} />
      ))}

      {annotations.filter((a) => visible(a.start, a.end)).map((a) => (
        <Brace key={a.id} a={a} x={x} ppy={ppy} research={research}
          onOpen={() => onOpenItem({ kind: "annotation", item: a, laneKey: a.laneKey, laneId: person.id })}
          onDelete={() => onDeleteAnn(a.id)} />
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
    openProject, createProject, importProject, deleteProject, renameProject,
    addSource, deleteSource, updateSource,
    setPeople, updatePerson, setAnnotations, setEras, setFocusId, setRelativeIds, setView, setCtxOn,
  } = useProject(storage);

  // Derive working state from project (fallbacks keep UI stable during load)
  const people = project?.people ?? SAMPLE_PEOPLE;
  const annotations = project?.annotations ?? SAMPLE_ANNOTATIONS;
  const eras = project?.eras ?? SAMPLE_ERAS;
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
  const [itemModal, setItemModal] = useState(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
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
  const sourcesById = useMemo(() => Object.fromEntries(sources.map((s) => [s.id, s])), [sources]);
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
    if (d?.kind === "ann") {
      const laneKey = d.laneKey;
      const laneIsPerson = laneKey.startsWith("p:");
      const laneId = laneIsPerson ? laneKey.slice(2) : null;
      if (draft && draft.end - draft.start > 0.75) {
        const start = Math.round(draft.start), end = Math.round(draft.end);
        setItemModal({ mode: "create", kind: laneIsPerson ? "group" : "era", laneKey, laneId, laneIsPerson, item: { start, end } });
      } else if (laneIsPerson) {
        // a click on empty person-lane space → new point event at that year
        const year = Math.round(d.startYear);
        setItemModal({ mode: "create", kind: "event", laneKey, laneId, laneIsPerson, item: { year, start: year, end: year } });
      }
    }
    setDraft(null);
  };

  /* open an existing item: read-only in view mode, editable in research mode */
  const openItem = (descriptor) => setItemModal({
    ...descriptor,
    mode: research ? "edit" : "view",
    id: descriptor.item?.id,
    laneIsPerson: descriptor.laneKey ? descriptor.laneKey.startsWith("p:") : false,
  });

  const saveItem = ({ kind, mode, id, laneKey, laneId, values }) => {
    if (kind === "birth" || kind === "death") {
      updatePerson(laneId, (p) => ({ ...p, [kind]: { ...p[kind], ...values } }));
    } else if (kind === "era") {
      if (mode === "edit") setEras((es) => es.map((x) => (x.id === id ? { ...x, ...values } : x)));
      else setEras((es) => [...es, createEra(values)]);
    } else if (kind === "annotation") {
      if (mode === "edit") setAnnotations((as) => as.map((x) => (x.id === id ? { ...x, ...values } : x)));
      else setAnnotations((as) => [...as, createAnnotation({ laneKey, ...values })]);
    } else {
      const arrKey = ARR_KEY[kind];
      const factory = { event: createEvent, period: createPeriod, group: createGroup, media: createMediaPin }[kind];
      updatePerson(laneId, (p) => {
        const arr = p[arrKey] ?? [];
        return mode === "edit"
          ? { ...p, [arrKey]: arr.map((x) => (x.id === id ? { ...x, ...values } : x)) }
          : { ...p, [arrKey]: [...arr, factory(values)] };
      });
    }
    setItemModal(null);
  };

  const deleteItem = ({ kind, id, laneId }) => {
    if (kind === "era") setEras((es) => es.filter((x) => x.id !== id));
    else if (kind === "annotation") setAnnotations((as) => as.filter((x) => x.id !== id));
    else updatePerson(laneId, (p) => ({ ...p, [ARR_KEY[kind]]: (p[ARR_KEY[kind]] ?? []).filter((x) => x.id !== id) }));
    setItemModal(null);
  };

  const showTip = (e, lines) => setTooltip({ x: e.clientX, y: e.clientY, lines: lines.filter(Boolean) });
  const hideTip = () => setTooltip(null);
  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3500); };

  /* export / import */
  const downloadBlob = (blob, filename) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const safeProjectName = (project?.name ?? "family-atlas").replace(/[^a-zA-Z0-9._-]+/g, "-");

  const verifiedFactCount = useMemo(() => people.reduce((n, p) =>
    n + (p.birth?.verified ? 1 : 0) + (p.death?.verified ? 1 : 0)
    + (p.events || []).filter((e) => e.verified).length
    + (p.periods || []).filter((r) => r.verified).length
    + (p.groups || []).filter((g) => g.verified).length, 0), [people]);

  const doExportGedcom = () => {
    downloadBlob(new Blob([exportGedcom(people, { sources })], { type: "text/plain" }), `${safeProjectName}.ged`);
    flash(`Exported GEDCOM 5.5.1 — ${verifiedFactCount} verified fact${verifiedFactCount === 1 ? "" : "s"} across ${people.length} people`);
    setExportMenuOpen(false);
  };
  const doExportZip = async () => {
    try {
      const blob = await exportProjectZip(project, storage);
      downloadBlob(blob, `${safeProjectName}.meridian.zip`);
      flash("Exported Meridian bundle (.zip) — full fidelity");
    } catch (err) {
      console.error("Meridian: bundle export failed", err);
      flash("Bundle export failed — see console.");
    }
    setExportMenuOpen(false);
  };
  const doImportFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      if (f.name.toLowerCase().endsWith(".zip")) {
        const proj = await importProjectZip(f, storage);
        await importProject(proj);
        initRef.current = false;
        flash(`Imported project "${proj.name}".`);
      } else {
        const { people: imp, sources: impSrc } = parseGedcom(await f.text());
        if (!imp.length) { flash("No individuals found in that file."); }
        else {
          setPeople((ps) => [...ps, ...imp.filter((p) => !ps.some((q) => q.id === p.id))]);
          impSrc.forEach((s) => addSource(s));
          flash(`Imported ${imp.length} people${impSrc.length ? ` and ${impSrc.length} source${impSrc.length === 1 ? "" : "s"}` : ""} — add them from "+ relative".`);
        }
      }
    } catch (err) {
      console.error("Meridian: import failed", err);
      flash("Import failed — is the file a valid GEDCOM or Meridian bundle?");
    }
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
        <button style={btnStyle(research)} onClick={() => setResearch((r) => !r)} title="Drag across a lane to add items · click items to edit">
          {research ? "✓ research mode" : "❧ research mode"}
        </button>
        <button style={btnStyle(legendOpen)} onClick={() => setLegendOpen(true)} title="Event marker legend">Legend</button>

        <span style={{ flex: 1 }} />

        <label style={{ font: "600 11px Archivo, sans-serif", color: C.inkSoft }}>Context source</label>
        <select defaultValue="sample" style={{ font: "600 12px Archivo, sans-serif", background: C.paperHi, color: C.ink, border: `1px solid ${C.ink}`, borderRadius: 3, padding: "4px 6px" }}>
          <option value="sample">Built-in sample</option>
          <option disabled>Wikidata — coming soon</option>
          <option disabled>time.graphics — coming soon</option>
        </select>

        <button style={btnStyle(false)} onClick={() => fileRef.current?.click()} title="Import a Meridian bundle (.zip) or a GEDCOM (.ged)">Import</button>
        <input ref={fileRef} type="file" accept=".zip,.ged,.gedcom,.txt" onChange={doImportFile} style={{ display: "none" }} />

        <div style={{ position: "relative" }}>
          <button style={btnStyle(exportMenuOpen)} onClick={() => setExportMenuOpen((o) => !o)} title="Export this project">Export ▾</button>
          {exportMenuOpen && (
            <>
              <div onClick={() => setExportMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 19 }} />
              <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 20, minWidth: 230,
                background: C.paperHi, border: `1px solid ${C.ink}`, borderRadius: 4, boxShadow: "0 6px 18px rgba(0,0,0,.18)",
                display: "flex", flexDirection: "column", padding: 4, gap: 2 }}>
                <button onClick={doExportZip} style={{ ...btnStyle(false), border: "none", textAlign: "left", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1, padding: "6px 8px" }}>
                  <span style={{ font: "600 12px Archivo, sans-serif", color: C.ink }}>Meridian project (.zip)</span>
                  <span style={{ font: "400 10.5px Archivo, sans-serif", color: C.inkSoft }}>Full fidelity — everything, incl. media</span>
                </button>
                <button onClick={doExportGedcom} style={{ ...btnStyle(false), border: "none", textAlign: "left", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1, padding: "6px 8px" }}>
                  <span style={{ font: "600 12px Archivo, sans-serif", color: C.ink }}>GEDCOM (.ged)</span>
                  <span style={{ font: "400 10.5px Archivo, sans-serif", color: C.inkSoft }}>Standard 5.5.1 — verified facts only</span>
                </button>
              </div>
            </>
          )}
        </div>

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

            {/* era bands — full-board shared periods */}
            {eras.filter((e) => e.end >= viewRange[0] && e.start <= viewRange[1]).map((e) => {
              const ec = e.color || C.slate;
              return (
                <div key={e.id} style={{ position: "absolute", left: x(e.start), width: Math.max(2, (e.end - e.start) * view.ppy), top: 0, bottom: 0, background: hexA(ec, 0.07), borderLeft: `1px solid ${hexA(ec, 0.4)}`, borderRight: `1px solid ${hexA(ec, 0.4)}` }}>
                  <span onPointerDown={stopPD} onClick={() => openItem({ kind: "era", item: e, laneKey: null, laneId: null })}
                    style={{ position: "absolute", top: 2, left: 5, font: "700 8.5px Archivo, sans-serif", letterSpacing: ".1em", textTransform: "uppercase", color: C.paperHi, background: hexA(ec, 0.92), padding: "1px 5px", borderRadius: 2, cursor: "pointer", pointerEvents: "auto", whiteSpace: "nowrap" }}>{e.label}</span>
                </div>
              );
            })}
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
                    sourcesById={sourcesById} storage={storage} research={research} onOpenItem={openItem}
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
                  sourcesById={sourcesById} storage={storage} research={research} onOpenItem={openItem}
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
        <span>{research ? "research mode: drag a lane to add · click an item to edit" : "click any item for details · hover for the year & ages"}</span>
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

      {/* item modal — create / edit / view */}
      {itemModal && (
        <ItemModal
          descriptor={itemModal}
          sources={sources}
          storage={storage}
          onSave={saveItem}
          onDelete={deleteItem}
          onClose={() => setItemModal(null)}
        />
      )}

      {/* event marker legend */}
      {legendOpen && (
        <Modal title="Event markers" onClose={() => setLegendOpen(false)} width={300}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {Object.entries(EVENT_TYPES).map(([t, def]) => (
              <div key={t} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 18, textAlign: "center", color: def.color, font: "600 13px Archivo, sans-serif" }}>{def.icon}</span>
                <span style={{ width: 12, height: 12, transform: "rotate(45deg)", background: C.paperHi, border: `1.8px solid ${def.color}`, display: "inline-block" }} />
                <span style={{ font: "500 12px Archivo, sans-serif", color: C.ink }}>{def.label}</span>
              </div>
            ))}
          </div>
          <div style={{ font: "italic 500 11px Fraunces, Georgia, serif", color: C.inkSoft, marginTop: 12 }}>
            In research mode, drag across a lane to add roles, groups, brackets, or eras; click any item to edit.
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
          onUpdate={updateSource}
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
