import React, { useState, useRef } from "react";
import { C, btnStyle, hexA, SOURCE_TYPES, SOURCE_TYPE_LABELS, SOURCE_TYPE_ACCEPT } from "../theme.js";
import { createSource } from "../models/project.js";

const FILTER_TABS = ["all", ...SOURCE_TYPES];

const FILTER_LABELS = {
  all: "All", image: "Images", document: "Documents",
  audio: "Audio", video: "Video", url: "Links", text: "Notes",
};

function TypeBadge({ type }) {
  return (
    <span style={{
      font: "700 9px 'IBM Plex Mono', monospace",
      color: C.inkSoft,
      background: hexA(C.ink, 0.08),
      border: `1px solid ${C.rule}`,
      borderRadius: 2,
      padding: "1px 4px",
      letterSpacing: ".06em",
      flexShrink: 0,
    }}>
      {SOURCE_TYPE_LABELS[type] ?? type.toUpperCase()}
    </span>
  );
}

function AddSourceModal({ people, storage, onSave, onClose }) {
  const [type, setType] = useState("text");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [repository, setRepository] = useState("");
  const [description, setDescription] = useState("");
  const [citation, setCitation] = useState("");
  const [verified, setVerified] = useState(false);
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState(null);
  const [linkedPersonIds, setLinkedPersonIds] = useState([]);
  const [yearStart, setYearStart] = useState("");
  const [yearEnd, setYearEnd] = useState("");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  const togglePerson = (id) =>
    setLinkedPersonIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      let blobKey = null;
      let fileName = null;
      let mimeType = null;

      if (file && ["image", "document", "audio", "video"].includes(type)) {
        blobKey = `blob_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        fileName = file.name;
        mimeType = file.type;
        await storage.saveBlob(blobKey, file);
      }

      const ys = parseInt(yearStart), ye = parseInt(yearEnd);
      const linkedYearRange = yearStart && yearEnd && !isNaN(ys) && !isNaN(ye)
        ? [Math.min(ys, ye), Math.max(ys, ye)]
        : null;

      onSave(createSource({
        title: title.trim(),
        type,
        date: date.trim(),
        repository: repository.trim(),
        description: description.trim(),
        citation: citation.trim(),
        verified,
        url: type === "url" ? url.trim() || null : null,
        text: type === "text" ? text.trim() || null : null,
        blobKey,
        fileName,
        mimeType,
        linkedPersonIds,
        linkedYearRange,
      }));
      onClose();
    } catch (err) {
      console.error("Meridian: failed to save source", err);
      setSaving(false);
    }
  };

  const fieldStyle = {
    width: "100%", boxSizing: "border-box",
    font: "500 12px Archivo, sans-serif", color: C.ink,
    background: "#fff", border: `1px solid ${C.rule}`,
    borderRadius: 3, padding: "5px 8px",
  };
  const labelStyle = { font: "600 10px Archivo, sans-serif", color: C.inkSoft, letterSpacing: ".08em", textTransform: "uppercase", display: "block", marginBottom: 3, marginTop: 10 };

  return (
    <div
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      style={{ position: "fixed", inset: 0, background: "rgba(25,32,28,.5)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{ background: C.paperHi, border: `1px solid ${C.ink}`, borderRadius: 4, padding: 18, width: 460, maxWidth: "94vw", maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 12px 40px rgba(20,28,24,.35)" }}
      >
        <div style={{ font: "700 15px Fraunces, Georgia, serif", color: C.ink, marginBottom: 12, flexShrink: 0 }}>Add source</div>

        <div style={{ overflowY: "auto", flex: 1 }}>
          {/* Type */}
          <label style={labelStyle}>Type</label>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {SOURCE_TYPES.map((t) => (
              <button key={t} style={{ ...btnStyle(type === t), padding: "3px 9px", fontSize: 11 }} onClick={() => setType(t)}>
                {FILTER_LABELS[t]}
              </button>
            ))}
          </div>

          {/* Title */}
          <label style={labelStyle}>Title *</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Source title" style={fieldStyle} />

          {/* Content by type */}
          {["image", "document", "audio", "video"].includes(type) && (
            <>
              <label style={labelStyle}>File</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button style={{ ...btnStyle(false), padding: "4px 10px", fontSize: 11 }} onClick={() => fileRef.current?.click()}>
                  {file ? "Change file" : "Choose file"}
                </button>
                {file && <span style={{ font: "400 10.5px 'IBM Plex Mono', monospace", color: C.inkSoft }}>{file.name}</span>}
              </div>
              <input ref={fileRef} type="file" accept={SOURCE_TYPE_ACCEPT[type]} onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ display: "none" }} />
            </>
          )}

          {type === "url" && (
            <>
              <label style={labelStyle}>URL</label>
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" style={fieldStyle} />
            </>
          )}

          {type === "text" && (
            <>
              <label style={labelStyle}>Text / Note</label>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Transcription, note, or extract…" style={{ ...fieldStyle, resize: "vertical" }} />
            </>
          )}

          {/* Metadata */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={labelStyle}>Date</label>
              <input value={date} onChange={(e) => setDate(e.target.value)} placeholder="1923, circa 1900…" style={fieldStyle} />
            </div>
            <div>
              <label style={labelStyle}>Repository</label>
              <input value={repository} onChange={(e) => setRepository(e.target.value)} placeholder="National Archives…" style={fieldStyle} />
            </div>
          </div>

          <label style={labelStyle}>Description</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description" style={fieldStyle} />

          <label style={labelStyle}>Citation (APA7)</label>
          <input value={citation} onChange={(e) => setCitation(e.target.value)} placeholder="Author, A. A. (Year). Title. Publisher." style={fieldStyle} />

          <label style={{ ...labelStyle, marginTop: 12 }}>Verification</label>
          <button onClick={() => setVerified((v) => !v)} title="Verified sources can be cited in standard GEDCOM export"
            style={{ display: "inline-flex", alignItems: "center", gap: 7, cursor: "pointer", background: "none", border: "none", padding: 0 }}>
            <span style={{ width: 16, height: 16, borderRadius: 3, border: `1.5px solid ${verified ? "#34635C" : C.rule}`, background: verified ? "#34635C" : "#fff", color: C.paperHi, font: "700 11px Archivo", display: "flex", alignItems: "center", justifyContent: "center" }}>{verified ? "✓" : ""}</span>
            <span style={{ font: "500 12px Archivo, sans-serif", color: C.ink }}>Verified source</span>
          </button>

          {/* Link to people */}
          {people.length > 0 && (
            <>
              <label style={labelStyle}>Link to people</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {people.map((p) => {
                  const active = linkedPersonIds.includes(p.id);
                  return (
                    <button key={p.id} style={{ ...btnStyle(active), padding: "3px 9px", fontSize: 11 }} onClick={() => togglePerson(p.id)}>
                      {p.name.split(" ")[0]}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* Year range */}
          <label style={labelStyle}>Year range (optional)</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input value={yearStart} onChange={(e) => setYearStart(e.target.value)} placeholder="From" style={{ ...fieldStyle, width: 80 }} />
            <span style={{ font: "500 12px Archivo, sans-serif", color: C.inkSoft }}>–</span>
            <input value={yearEnd} onChange={(e) => setYearEnd(e.target.value)} placeholder="To" style={{ ...fieldStyle, width: 80 }} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14, flexShrink: 0 }}>
          <button style={btnStyle(false)} onClick={onClose}>Cancel</button>
          <button style={btnStyle(true)} onClick={handleSave} disabled={!title.trim() || saving}>
            {saving ? "Saving…" : "Save source"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SourcesPanel({ sources = [], people = [], storage, onAdd, onDelete, onUpdate, onClose }) {
  const [filter, setFilter] = useState("all");
  const [addOpen, setAddOpen] = useState(false);

  const filtered = filter === "all" ? sources : sources.filter((s) => s.type === filter);

  const panelStyle = {
    position: "fixed", top: 0, right: 0, bottom: 0,
    width: 300, background: C.paperHi,
    borderLeft: `1.5px solid ${C.ink}`,
    display: "flex", flexDirection: "column",
    zIndex: 50,
    boxShadow: "-6px 0 24px rgba(20,28,24,.18)",
  };

  return (
    <>
      <div style={panelStyle}>
        {/* Header */}
        <div style={{ padding: "12px 14px 0", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ font: "700 15px Fraunces, Georgia, serif", color: C.ink }}>
              Sources
              {sources.length > 0 && (
                <span style={{ font: "400 11px 'IBM Plex Mono', monospace", color: C.inkSoft, marginLeft: 8 }}>({sources.length})</span>
              )}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button style={{ ...btnStyle(true), padding: "3px 9px", fontSize: 11 }} onClick={() => setAddOpen(true)}>+ Add</button>
              <button style={{ ...btnStyle(false), padding: "3px 8px", fontSize: 13, lineHeight: 1 }} onClick={onClose} title="Close">×</button>
            </div>
          </div>

          {/* Filter tabs */}
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", paddingBottom: 10, borderBottom: `1px solid ${C.rule}` }}>
            {FILTER_TABS.map((t) => {
              const count = t === "all" ? sources.length : sources.filter((s) => s.type === t).length;
              if (t !== "all" && count === 0) return null;
              return (
                <button
                  key={t}
                  style={{ ...btnStyle(filter === t), padding: "2px 7px", fontSize: 10 }}
                  onClick={() => setFilter(t)}
                >
                  {FILTER_LABELS[t]}{count > 0 ? ` ${count}` : ""}
                </button>
              );
            })}
          </div>
        </div>

        {/* Source list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 14px" }}>
          {filtered.length === 0 && (
            <div style={{ font: "italic 500 12px Fraunces, Georgia, serif", color: C.inkSoft, paddingTop: 16, textAlign: "center" }}>
              {sources.length === 0 ? "No sources yet. Add documents, photos, links, and notes to build your evidence trail." : "No sources of this type."}
            </div>
          )}

          {filtered.map((s) => (
            <div key={s.id} style={{ padding: "8px 10px", marginBottom: 6, background: C.paper, border: `1px solid ${C.rule}`, borderRadius: 3 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 7 }}>
                <TypeBadge type={s.type} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: "600 12px Fraunces, Georgia, serif", color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.title}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                    <button onClick={() => onUpdate?.(s.id, { verified: !s.verified })} title="Toggle verified — verified sources may be cited in GEDCOM export"
                      style={{ font: "700 8.5px Archivo, sans-serif", letterSpacing: ".06em", textTransform: "uppercase", cursor: "pointer", borderRadius: 2, padding: "1px 5px",
                        color: s.verified ? C.paperHi : C.inkSoft, background: s.verified ? "#34635C" : "none", border: `1px solid ${s.verified ? "#34635C" : C.rule}` }}>
                      {s.verified ? "✓ Verified" : "Unverified"}
                    </button>
                    {s.fileMissing && (
                      <span title="The media file is not stored; only its citation is kept" style={{ font: "700 8.5px Archivo, sans-serif", letterSpacing: ".06em", textTransform: "uppercase", color: C.focus, border: `1px solid ${hexA(C.focus, 0.5)}`, borderRadius: 2, padding: "1px 5px" }}>File missing</span>
                    )}
                  </div>
                  {s.date && (
                    <div style={{ font: "400 10px 'IBM Plex Mono', monospace", color: C.inkSoft, marginTop: 2 }}>{s.date}</div>
                  )}
                  {s.description && (
                    <div style={{ font: "400 11px Archivo, sans-serif", color: C.inkSoft, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.description}</div>
                  )}
                  {s.linkedPersonIds?.length > 0 && (
                    <div style={{ font: "400 9.5px Archivo, sans-serif", color: hexA(C.ink, 0.5), marginTop: 3 }}>
                      {s.linkedPersonIds.length} {s.linkedPersonIds.length === 1 ? "person" : "people"} linked
                    </div>
                  )}
                  {s.url && (
                    <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ font: "400 9.5px 'IBM Plex Mono', monospace", color: C.slate, display: "block", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.url}
                    </a>
                  )}
                </div>
                <button
                  onClick={() => onDelete(s.id)}
                  title="Remove source"
                  style={{ background: "none", border: "none", cursor: "pointer", color: C.inkSoft, fontSize: 14, padding: "0 2px", lineHeight: 1, flexShrink: 0 }}
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {addOpen && (
        <AddSourceModal
          people={people}
          storage={storage}
          onSave={onAdd}
          onClose={() => setAddOpen(false)}
        />
      )}
    </>
  );
}
