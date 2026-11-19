import React from "react";
import { C, btnStyle } from "../../theme.js";
import { otherCalendarNote } from "../../evidence/domain/calendar.js";

// Records on this page (P6.T2 listing, P6.T4 review): one card per record with its people and every claim.

const small = { font: "400 11.5px Archivo, sans-serif", color: C.inkSoft, lineHeight: 1.5 };
const mono = { font: "400 10.5px 'IBM Plex Mono', monospace", color: C.inkSoft };
const mini = { ...btnStyle(false), padding: "2px 8px", fontSize: 11 };
export const STATUS_COLOR = { proposed: C.rel[1], confirmed: C.rel[2], rejected: C.focus };

const LABELS = {
  name: "name", sex: "sex", role: "role", age: "age", occupation: "occupation", residence: "residence", houseNumber: "house no.",
  "birth.date": "born", "birth.place": "birthplace", "death.date": "died", "death.place": "place of death", "event.date": "date", "event.place": "place",
  childOf: "child of", parentOf: "parent of", spouseOf: "spouse of", godparentOf: "godparent of", witnessFor: "witness for", informantFor: "informant for",
  "x-religion": "religion",
};
export const propertyLabel = (p) => LABELS[p] ?? p.replace(/^x-/, "").replace(/-unparsed$/, " (as written)");

/** Value shown for an assertion: relations name the other person, everything else is the value as written. */
export function valueOf(a, personaNames) {
  if (a.objectPersonaId) return `${personaNames.get(a.objectPersonaId) ?? "?"}${a.originalValue ? ` (“${a.originalValue}”)` : ""}`;
  return a.originalValue;
}

/**
 * @param {{ items: object[], selectedRegionId?: string, onSelectRegion: (id) => void, renderActions?: (assertion, item) => React.ReactNode, renderRecordActions?: (item) => React.ReactNode, renderCrop?: (item) => React.ReactNode }} props
 */
export default function RecordsTab({ items, selectedRegionId, onSelectRegion, renderActions, renderRecordActions, renderCrop }) {
  if (!items.length) return <div style={small}>No records on this page yet.</div>;
  return (
    <div data-testid="records-list" style={{ display: "grid", gap: 8 }}>
      {items.map((item) => {
        const names = new Map(item.personas.map((p) => [p.persona.id, p.persona.nameAsWritten]));
        const row = (a) => (
          <li key={a.id} data-testid="assertion-row" style={{ ...small, display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap", color: C.ink }}>
            <span style={{ color: C.inkSoft, minWidth: 74 }}>{propertyLabel(a.property)}</span>
            <span style={{ fontWeight: 600, textDecoration: a.status === "rejected" ? "line-through" : "none" }}>{valueOf(a, names)}</span>
            <span style={{ ...mono, color: STATUS_COLOR[a.status] }}>{a.status}{a.agent === "manual" ? " · you" : ` · ${a.agent}`}{a.confidence != null ? ` · ${Math.round(a.confidence * 100)}%` : ""}</span>
            {renderActions?.(a, item)}
          </li>
        );
        const ev = item.record.event;
        return (
          <div key={item.record.id} data-testid="record-card" style={{ border: `1px solid ${item.regionId === selectedRegionId ? C.focus : C.rule}`, borderRadius: 3, padding: 8, background: "#fff" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
              <span style={{ font: "700 12.5px Archivo, sans-serif", color: C.ink }}>
                {item.record.kind}{ev ? ` · ${ev.earliest === ev.latest ? ev.earliest : `${ev.earliest ?? "…"} – ${ev.latest ?? "…"}`} (${ev.calendar})` : ""}
                {otherCalendarNote(ev) && <span style={{ font: "400 11px Archivo, sans-serif", color: C.inkSoft }}> = {otherCalendarNote(ev)}</span>}
              </span>
              <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={mono}>{item.counts.proposed} proposed · {item.counts.confirmed} confirmed{item.counts.rejected ? ` · ${item.counts.rejected} rejected` : ""}</span>
                {item.region && item.region.kind !== "page" && <button style={mini} onClick={() => onSelectRegion(item.regionId)}>Show region</button>}
                {renderRecordActions?.(item)}
              </span>
            </div>
            {renderCrop?.(item)}
            {item.recordAssertions.length > 0 && <ul style={{ listStyle: "none", margin: "4px 0", padding: 0 }}>{item.recordAssertions.map(row)}</ul>}
            {item.personas.map(({ persona, assertions }) => (
              <div key={persona.id} style={{ marginTop: 4, paddingTop: 4, borderTop: `1px solid ${C.ruleFaint}` }}>
                <div style={{ font: "600 12px Archivo, sans-serif", color: C.ink }}>{persona.nameAsWritten} <span style={mono}>{persona.role}</span></div>
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>{assertions.filter((a) => a.property !== "name" || a.originalValue !== persona.nameAsWritten || a.status !== "confirmed").map(row)}</ul>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
