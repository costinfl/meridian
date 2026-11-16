import React, { useState } from "react";
import { C, btnStyle } from "../../theme.js";
import { correctAssertion } from "../../evidence/index.js";

// Review of proposals (P6.T4): Confirm, Reject or Correct one value; Confirm all for a record; and a crop of the
// region the record was read from. Every button is an explicit user action (I6).

const small = { font: "400 11.5px Archivo, sans-serif", color: C.inkSoft, lineHeight: 1.5 };
const tiny = { ...btnStyle(false), padding: "0 6px", fontSize: 10.5 };
const input = { font: "500 11.5px Archivo, sans-serif", color: C.ink, background: "#fff", border: `1px solid ${C.rule}`, borderRadius: 3, padding: "1px 4px", boxSizing: "border-box" };
const DATE_PROPERTIES = new Set(["birth.date", "death.date", "event.date"]);

/** Style that shows `box` (0-1 on the page) of an image as a CSS background, `width` px wide. */
export function cropStyle(url, box, pageWidth, pageHeight, width = 280) {
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  const height = Math.max(24, Math.min(320, Math.round(width * (bh * pageHeight) / (bw * pageWidth))));
  const pos = (start, size) => (size >= 1 ? 0 : (start / (1 - size)) * 100);
  return {
    width, height, backgroundImage: `url("${url}")`, backgroundRepeat: "no-repeat",
    backgroundSize: `${100 / bw}% ${100 / bh}%`, backgroundPosition: `${pos(box.x0, bw)}% ${pos(box.y0, bh)}%`,
    border: `1px solid ${C.rule}`, borderRadius: 2, flexShrink: 0,
  };
}

export function RecordCrop({ imageUrl, item, page }) {
  if (!imageUrl || !item.region || item.region.kind === "page" || !page) return null;
  return <div data-testid="record-crop" role="img" aria-label={`Region of the ${item.record.kind} record`} style={{ ...cropStyle(imageUrl, item.region.box, page.width, page.height), margin: "6px 0" }} />;
}

/** Buttons for one assertion. `onDone(message)` refreshes the list. */
export function ReviewActions({ library, assertion: a, onDone }) {
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  if (a.status !== "proposed" && !editing) {
    return a.status === "confirmed" && !a.objectPersonaId && a.agent !== "manual"
      ? <button style={tiny} onClick={() => setEditing({ originalValue: a.originalValue })} aria-label={`Correct ${a.property} ${a.originalValue}`}>Correct</button>
      : null;
  }
  const act = async (fn, msg) => {
    setBusy(true);
    try { await fn(); setEditing(null); await onDone(msg); }
    catch (e) { await onDone(`Not saved: ${e.message}`); }
    finally { setBusy(false); }
  };
  const label = `${a.property} ${a.originalValue}`;
  if (editing) {
    const isDate = DATE_PROPERTIES.has(a.property), isAge = a.property === "age";
    const set = (k) => (e) => setEditing({ ...editing, [k]: e.target.value });
    return (
      <span data-testid="correct-form" style={{ display: "inline-flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
        <input aria-label="Corrected value as written" value={editing.originalValue} onChange={set("originalValue")} style={{ ...input, width: 170 }} autoFocus />
        {isDate && <>
          <input aria-label="Corrected day" placeholder="day" value={editing.day ?? ""} onChange={set("day")} style={{ ...input, width: 38 }} />
          <input aria-label="Corrected month" placeholder="month" value={editing.month ?? ""} onChange={set("month")} style={{ ...input, width: 44 }} />
          <input aria-label="Corrected year" placeholder="year" value={editing.year ?? ""} onChange={set("year")} style={{ ...input, width: 50 }} />
        </>}
        {isAge && <input aria-label="Corrected age" placeholder="age" value={editing.value ?? ""} onChange={set("value")} style={{ ...input, width: 44 }} />}
        <button style={tiny} disabled={busy} onClick={() => act(() => correctAssertion({ library, assertionId: a.id, fields: editing }), "Correction saved (confirmed). The proposal is kept, superseded.")}>Save</button>
        <button style={tiny} disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
      </span>
    );
  }
  return (
    <span style={{ display: "inline-flex", gap: 4 }}>
      <button style={tiny} disabled={busy} aria-label={`Confirm ${label}`} onClick={() => act(() => library.assertions.confirmAssertion(a.id, { decidedBy: "user" }), "Confirmed.")}>Confirm</button>
      <button style={tiny} disabled={busy} aria-label={`Reject ${label}`} onClick={() => act(() => library.assertions.rejectAssertion(a.id, { decidedBy: "user" }), "Rejected. It will not be proposed again.")}>Reject</button>
      {!a.objectPersonaId && <button style={tiny} disabled={busy} aria-label={`Correct ${label}`} onClick={() => {
        const n = a.normalizedValue;
        setEditing({ originalValue: a.originalValue, ...(n?.earliest ? { year: n.earliest.slice(0, 4) } : {}), ...(Number.isInteger(n?.value) ? { value: String(n.value) } : {}) });
      }}>Correct</button>}
    </span>
  );
}

/** "Confirm all" for a record's proposals. */
export function ConfirmAll({ library, item, onDone }) {
  const proposed = [...item.recordAssertions, ...item.personas.flatMap((p) => p.assertions)].filter((a) => a.status === "proposed");
  if (!proposed.length) return null;
  return (
    <button style={tiny} aria-label={`Confirm all ${proposed.length} proposed values of this record`} onClick={async () => {
      try { for (const a of proposed) await library.assertions.confirmAssertion(a.id, { decidedBy: "user" }); await onDone(`Confirmed ${proposed.length} values.`); }
      catch (e) { await onDone(`Not saved: ${e.message}`); }
    }}>Confirm all {proposed.length}</button>
  );
}
