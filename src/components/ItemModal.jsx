import React, { useState, useEffect } from "react";
import { Modal } from "./Modal.jsx";
import { C, btnStyle, hexA, ITEM_COLORS, EVENT_TYPES, eventType } from "../theme.js";

/* Metadata per timeline-item kind. `point` items live at a single year;
   the rest span start→end. `titleField` is where the display name is stored. */
const KIND_META = {
  event:      { label: "Event",             point: true,  titleField: "label", hasType: true },
  period:     { label: "Role / occupation", point: false, titleField: "label" },
  group:      { label: "Event group",       point: false, titleField: "label" },
  annotation: { label: "Bracket",           point: false, titleField: "title" },
  era:        { label: "Era band",          point: false, titleField: "label" },
  media:      { label: "Media pin",          point: true,  titleField: "label", needsSource: true },
  birth:      { label: "Birth",             point: true,  titleField: "place", fact: true },
  death:      { label: "Death",             point: true,  titleField: "place", fact: true },
};

// Kinds that carry a `verified` flag (i.e. can flow into standard GEDCOM export).
const VERIFIABLE = new Set(["event", "period", "group", "birth", "death"]);

const PERSON_KINDS = ["event", "period", "group", "annotation", "era", "media"];
const CONTEXT_KINDS = ["era"];

const fieldStyle = {
  width: "100%", boxSizing: "border-box",
  font: "500 12px Archivo, sans-serif", color: C.ink,
  background: "#fff", border: `1px solid ${C.rule}`,
  borderRadius: 3, padding: "5px 8px",
};
const labelStyle = { font: "600 10px Archivo, sans-serif", color: C.inkSoft, letterSpacing: ".08em", textTransform: "uppercase", display: "block", marginBottom: 3, marginTop: 10 };
const valueStyle = { font: "500 13px Archivo, sans-serif", color: C.ink, marginTop: 2 };

function initForm(kind, item) {
  const meta = KIND_META[kind];
  const title = item?.[meta.titleField] ?? "";
  return {
    title,
    year: String(item?.year ?? item?.start ?? ""),
    start: String(item?.start ?? ""),
    end: String(item?.end ?? ""),
    type: item?.type ?? "note",
    note: item?.note ?? "",
    color: item?.color ?? null,
    sourceId: item?.sourceId ?? "",
    verified: !!item?.verified,
  };
}

/* Read + open a source attachment (blob) as a temporary object URL. */
function SourceView({ source, storage }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let revoked = false, made = null;
    if (source?.blobKey && storage) {
      storage.loadBlob(source.blobKey).then((blob) => {
        if (revoked || !blob) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      }).catch(() => {});
    }
    return () => { revoked = true; if (made) URL.revokeObjectURL(made); };
  }, [source, storage]);

  if (!source) return null;
  const isImage = source.type === "image" || source.mimeType?.startsWith("image/");
  return (
    <div style={{ marginTop: 4, padding: "8px 10px", background: C.paper, border: `1px solid ${C.rule}`, borderRadius: 3 }}>
      <div style={{ font: "600 12px Fraunces, Georgia, serif", color: C.ink }}>{source.title}</div>
      {source.date && <div style={{ font: "400 10px 'IBM Plex Mono', monospace", color: C.inkSoft, marginTop: 1 }}>{source.date}</div>}
      {isImage && url && (
        <img src={url} alt={source.title} style={{ display: "block", maxWidth: "100%", maxHeight: 200, marginTop: 6, borderRadius: 3, border: `1px solid ${C.rule}` }} />
      )}
      {source.url && (
        <a href={source.url} target="_blank" rel="noopener noreferrer" style={{ font: "500 11px 'IBM Plex Mono', monospace", color: C.slate, display: "inline-block", marginTop: 6 }}>Open link ↗</a>
      )}
      {url && !isImage && (
        <a href={url} target="_blank" rel="noopener noreferrer" style={{ font: "500 11px 'IBM Plex Mono', monospace", color: C.slate, display: "inline-block", marginTop: 6 }}>Open file ↗</a>
      )}
      {source.text && (
        <div style={{ font: "400 11px Archivo, sans-serif", color: C.inkSoft, marginTop: 6, whiteSpace: "pre-wrap" }}>{source.text}</div>
      )}
    </div>
  );
}

export function ItemModal({ descriptor, sources = [], storage, onSave, onDelete, onClose }) {
  const [kind, setKind] = useState(descriptor.kind);
  const [form, setForm] = useState(() => initForm(descriptor.kind, descriptor.item));

  const meta = KIND_META[kind];
  const mode = descriptor.mode; // 'create' | 'edit' | 'view'
  const kindOptions = descriptor.laneIsPerson ? PERSON_KINDS : CONTEXT_KINDS;
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const linkableSources = kind === "media"
    ? sources.filter((s) => s.blobKey || s.url)
    : sources;
  const selectedSource = sources.find((s) => s.id === form.sourceId) || null;

  const doSave = () => {
    const meta2 = KIND_META[kind];
    const num = (v) => { const n = parseInt(v, 10); return isNaN(n) ? null : n; };
    const emit = (values) => onSave({ kind, mode, id: descriptor.id, laneKey: descriptor.laneKey, laneId: descriptor.laneId, values });

    if (meta2.fact) { // birth / death — year + place + verified only
      emit({ year: num(form.year), place: form.title.trim(), verified: form.verified });
      return;
    }
    const values = { [meta2.titleField]: form.title.trim(), note: form.note.trim() || "", color: form.color, sourceId: form.sourceId || null };
    if (meta2.hasType) values.type = form.type;
    if (VERIFIABLE.has(kind)) values.verified = form.verified;
    if (meta2.point) {
      values.year = num(form.year);
      if (values.year == null) return;
      if (kind === "media" && !values.sourceId) return;
    } else {
      const a = num(form.start), b = num(form.end);
      if (a == null || b == null) return;
      values.start = Math.min(a, b);
      values.end = Math.max(a, b);
    }
    emit(values);
  };

  const verifiedBadge = (on) => (
    <span style={{ font: "700 9px Archivo, sans-serif", letterSpacing: ".08em", textTransform: "uppercase", padding: "1px 6px", borderRadius: 2,
      color: on ? C.paperHi : C.inkSoft, background: on ? "#34635C" : hexA(C.ink, 0.08), border: `1px solid ${on ? "#34635C" : C.rule}` }}>
      {on ? "✓ Verified" : "Unverified"}
    </span>
  );

  const title = mode === "view" ? (form.title || meta.label) : mode === "edit" ? `Edit ${meta.label.toLowerCase()}` : "New timeline item";

  /* ---- read-only detail view ---- */
  if (mode === "view") {
    const dateText = meta.point ? String(descriptor.item?.year ?? "") : `${descriptor.item?.start ?? ""} – ${descriptor.item?.end ?? ""}`;
    const et = meta.hasType ? eventType(descriptor.item?.type) : null;
    return (
      <Modal title={title} onClose={onClose}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ font: "700 9px Archivo, sans-serif", letterSpacing: ".1em", textTransform: "uppercase", color: C.inkSoft, background: hexA(C.ink, 0.08), border: `1px solid ${C.rule}`, borderRadius: 2, padding: "1px 5px" }}>
            {et ? `${et.icon} ${et.label}` : meta.label}
          </span>
          <span style={{ font: "500 12px 'IBM Plex Mono', monospace", color: C.inkSoft }}>{dateText}</span>
          {VERIFIABLE.has(kind) && verifiedBadge(!!descriptor.item?.verified)}
        </div>
        {descriptor.item?.note && (
          <div style={{ ...valueStyle, whiteSpace: "pre-wrap", color: C.inkSoft, marginTop: 8 }}>{descriptor.item.note}</div>
        )}
        {selectedSource ? (
          <>
            <label style={labelStyle}>Source</label>
            <SourceView source={selectedSource} storage={storage} />
          </>
        ) : (
          <div style={{ font: "italic 500 11px Fraunces, Georgia, serif", color: hexA(C.ink, 0.4), marginTop: 10 }}>No source linked.</div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          <button style={btnStyle(false)} onClick={onClose}>Close</button>
        </div>
      </Modal>
    );
  }

  /* ---- create / edit form ---- */
  return (
    <Modal title={title} onClose={onClose}>
      {mode === "create" && (
        <>
          <label style={labelStyle}>Type</label>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {kindOptions.map((k) => (
              <button key={k} style={{ ...btnStyle(kind === k), padding: "3px 9px", fontSize: 11 }} onClick={() => setKind(k)}>
                {KIND_META[k].label}
              </button>
            ))}
          </div>
        </>
      )}

      <label style={labelStyle}>{meta.fact ? "Place" : meta.titleField === "title" ? "Title" : "Label"}{kind === "media" ? " (optional)" : ""}</label>
      <input autoFocus value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder={meta.fact ? "Place" : meta.label} style={fieldStyle} />

      {meta.point ? (
        <>
          <label style={labelStyle}>Year</label>
          <input value={form.year} onChange={(e) => set({ year: e.target.value })} placeholder="1893" style={{ ...fieldStyle, width: 120 }} />
        </>
      ) : (
        <div style={{ display: "flex", gap: 10 }}>
          <div>
            <label style={labelStyle}>From</label>
            <input value={form.start} onChange={(e) => set({ start: e.target.value })} placeholder="1880" style={{ ...fieldStyle, width: 110 }} />
          </div>
          <div>
            <label style={labelStyle}>To</label>
            <input value={form.end} onChange={(e) => set({ end: e.target.value })} placeholder="1921" style={{ ...fieldStyle, width: 110 }} />
          </div>
        </div>
      )}

      {meta.hasType && (
        <>
          <label style={labelStyle}>Marker type</label>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {Object.entries(EVENT_TYPES).map(([t, def]) => (
              <button key={t} title={def.label} style={{ ...btnStyle(form.type === t), padding: "3px 8px", fontSize: 11 }} onClick={() => set({ type: t })}>
                <span style={{ color: form.type === t ? C.paperHi : def.color, marginRight: 3 }}>{def.icon}</span>{def.label}
              </button>
            ))}
          </div>
        </>
      )}

      {!meta.fact && (
        <>
          <label style={labelStyle}>Color</label>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={() => set({ color: null })} title="Default color"
              style={{ width: 22, height: 22, borderRadius: 3, cursor: "pointer", background: C.paper, border: form.color == null ? `2px solid ${C.ink}` : `1px solid ${C.rule}`, font: "700 9px Archivo", color: C.inkSoft }}>A</button>
            {ITEM_COLORS.map((c) => (
              <button key={c} onClick={() => set({ color: c })} title={c}
                style={{ width: 22, height: 22, borderRadius: 3, cursor: "pointer", background: c, border: form.color === c ? `2px solid ${C.ink}` : `1px solid ${hexA(C.ink, 0.2)}` }} />
            ))}
          </div>
        </>
      )}

      {!meta.fact && sources.length > 0 && (
        <>
          <label style={labelStyle}>Source{kind === "media" ? " *" : " (optional)"}</label>
          <select value={form.sourceId} onChange={(e) => set({ sourceId: e.target.value })} style={fieldStyle}>
            <option value="">— none —</option>
            {linkableSources.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
          {selectedSource && <SourceView source={selectedSource} storage={storage} />}
        </>
      )}
      {kind === "media" && sources.length === 0 && (
        <div style={{ font: "italic 500 11px Fraunces, Georgia, serif", color: C.focus, marginTop: 8 }}>Add an image or document in the Sources panel first, then pin it here.</div>
      )}

      {kind !== "media" && !meta.fact && (
        <>
          <label style={labelStyle}>Note</label>
          <textarea value={form.note} onChange={(e) => set({ note: e.target.value })} rows={3}
            placeholder="Details, context, or research questions…" style={{ ...fieldStyle, resize: "vertical" }} />
        </>
      )}

      {VERIFIABLE.has(kind) && (
        <>
          <label style={labelStyle}>Verification</label>
          <button onClick={() => set({ verified: !form.verified })} title="Only verified facts are written to standard GEDCOM export"
            style={{ display: "inline-flex", alignItems: "center", gap: 7, cursor: "pointer", background: "none", border: "none", padding: 0 }}>
            <span style={{ width: 16, height: 16, borderRadius: 3, border: `1.5px solid ${form.verified ? "#34635C" : C.rule}`, background: form.verified ? "#34635C" : "#fff", color: C.paperHi, font: "700 11px Archivo", display: "flex", alignItems: "center", justifyContent: "center" }}>{form.verified ? "✓" : ""}</span>
            <span style={{ font: "500 12px Archivo, sans-serif", color: C.ink }}>Verified — include in GEDCOM export</span>
          </button>
        </>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "space-between", marginTop: 14 }}>
        <div>
          {mode === "edit" && !meta.fact && (
            <button style={{ ...btnStyle(false), color: C.focus, borderColor: hexA(C.focus, 0.5) }} onClick={() => onDelete({ kind, id: descriptor.id, laneId: descriptor.laneId })}>Delete</button>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={btnStyle(false)} onClick={onClose}>Cancel</button>
          <button style={btnStyle(true)} onClick={doSave}>{mode === "edit" ? "Save" : "Create"}</button>
        </div>
      </div>
    </Modal>
  );
}
