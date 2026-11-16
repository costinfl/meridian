import React, { useEffect, useState } from "react";
import { C, btnStyle } from "../../theme.js";
import { createEvidenceLibrary } from "../../evidence/index.js";
import { factEvidence, searchConfirmedEvidence } from "../../conclusions/factEvidence.js";
import { propertyLabel } from "./RecordsTab.jsx";
import { cropStyle } from "./AssertionReview.jsx";

// Evidence of a timeline fact (P6.T5), shown in the item editor when the evidence layer is on: the assertions
// attached to the fact with where they were read (and a crop of the page when its image is cached), and
// "Attach evidence…" to add a confirmed assertion found by a person's name.

const small = { font: "400 11.5px Archivo, sans-serif", color: C.inkSoft, lineHeight: 1.5 };
const mono = { font: "400 10.5px 'IBM Plex Mono', monospace", color: C.inkSoft };
const mini = { ...btnStyle(false), padding: "2px 8px", fontSize: 11 };
const input = { font: "500 12px Archivo, sans-serif", color: C.ink, background: "#fff", border: `1px solid ${C.rule}`, borderRadius: 3, padding: "2px 6px", boxSizing: "border-box" };

function Crop({ library, prov }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let u = null, live = true;
    (async () => {
      if (!prov.page || !prov.region || prov.region.kind === "page") return;
      for (const v of ["max2000", "max1600"]) {
        const hit = await library.pageCache.get(prov.page.id, v);
        if (hit && live) { u = URL.createObjectURL(new Blob([hit.bytes], { type: hit.mimeType })); setUrl(u); return; }
      }
    })().catch(() => {});
    return () => { live = false; if (u) URL.revokeObjectURL(u); };
  }, [library, prov]);
  if (!url) return null;
  return <div data-testid="evidence-crop" role="img" aria-label="Where it was read" style={{ ...cropStyle(url, prov.region.box, prov.page.width, prov.page.height, 240), margin: "4px 0" }} />;
}

export function describeProvenance(p) {
  const who = p.persona ? `${p.persona.nameAsWritten} (${p.persona.role})` : p.record ? `${p.record.kind} record` : "";
  const where = [p.source?.title ?? p.copy?.fileName, p.page ? `page ${p.page.pageIndex + 1}${p.page.label ? ` (${p.page.label})` : ""}` : p.assertion.citation?.pageLabel].filter(Boolean).join(", ");
  const value = p.object ? `${p.object.nameAsWritten}${p.assertion.originalValue ? ` (“${p.assertion.originalValue}”)` : ""}` : p.assertion.originalValue;
  return { who, where, value, what: propertyLabel(p.assertion.property) };
}

function Row({ library, p, action }) {
  const d = describeProvenance(p);
  return (
    <li data-testid="evidence-row" style={{ ...small, color: C.ink, padding: "4px 0", borderBottom: `1px solid ${C.ruleFaint}` }}>
      <div style={{ display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ color: C.inkSoft }}>{d.who} · {d.what}</span>
        <strong>{d.value}</strong>
        <span style={mono}>{p.assertion.status}{p.assertion.agent === "manual" ? " · you" : ` · ${p.assertion.agent}`}</span>
        {action}
      </div>
      {d.where && <div style={mono}>{d.where}</div>}
      <Crop library={library} prov={p} />
    </li>
  );
}

/** @param {{ storage, fact, defaultQuery?: string, onAttach: (assertionId) => Promise<void> }} props */
export default function FactEvidence({ storage, fact, defaultQuery = "", onAttach }) {
  const [library] = useState(() => createEvidenceLibrary(storage));
  const [ids, setIds] = useState(() => fact?.assertionIds ?? []);
  const [items, setItems] = useState(null);
  const [query, setQuery] = useState(defaultQuery);
  const [found, setFound] = useState(null);
  const [message, setMessage] = useState("");

  useEffect(() => { factEvidence(library, { assertionIds: ids }).then(setItems).catch((e) => setMessage(`Failed: ${e.message}`)); }, [library, ids]);

  const search = async () => {
    setMessage("");
    try { setFound(await searchConfirmedEvidence(library, query)); } catch (e) { setMessage(`Failed: ${e.message}`); }
  };
  const attach = async (assertionId) => {
    try { await onAttach(assertionId); setIds((x) => (x.includes(assertionId) ? x : [...x, assertionId])); setMessage("Attached. The fact's own values are unchanged."); }
    catch (e) { setMessage(`Not attached: ${e.message}`); }
  };

  return (
    <div data-testid="fact-evidence" style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.rule}` }}>
      <div style={{ font: "700 12px Archivo, sans-serif", color: C.ink, marginBottom: 4 }}>Evidence</div>
      {items == null ? <div style={small}>Loading…</div> : items.length === 0 ? <div style={small}>No evidence attached to this fact yet.</div> : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>{items.map((p) => <Row key={p.assertion.id} library={library} p={p} />)}</ul>
      )}
      {onAttach && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <input aria-label="Search confirmed evidence by name" placeholder="name as written, e.g. Loti" value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()} style={{ ...input, width: 200 }} />
            <button style={mini} disabled={!query.trim()} onClick={search}>Attach evidence…</button>
          </div>
          {found && (found.length === 0 ? <div style={small}>No confirmed evidence for that name. Confirm values in the Evidence panel first.</div> : (
            <ul data-testid="evidence-results" style={{ listStyle: "none", margin: "4px 0 0", padding: 0, maxHeight: 220, overflowY: "auto" }}>
              {found.map((p) => (
                <Row key={p.assertion.id} library={library} p={p} action={ids.includes(p.assertion.id)
                  ? <span style={mono}>attached</span>
                  : <button style={mini} aria-label={`Attach ${describeProvenance(p).what} ${describeProvenance(p).value}`} onClick={() => attach(p.assertion.id)}>Attach</button>} />
              ))}
            </ul>
          ))}
        </div>
      )}
      {message && <div role="status" data-testid="fact-evidence-status" style={{ ...small, color: message.startsWith("Not") || message.startsWith("Failed") ? C.focus : C.ink, marginTop: 4 }}>{message}</div>}
    </div>
  );
}
