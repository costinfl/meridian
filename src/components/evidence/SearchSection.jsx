import React, { useEffect, useMemo, useRef, useState } from "react";
import { C, btnStyle } from "../../theme.js";
import { SOURCE_KINDS } from "../../evidence/repositories/sourceStore.js";
import { createSearchClient } from "../../workers/searchClient.js";
import { cropStyle } from "./AssertionReview.jsx";

// Search (P7.T4): find words and names in everything read so far (page text, modern readings, values in
// records), with Romanian folding, name variants and sound-alike names. Proposed values are found and marked;
// rejected ones never are. The index lives in this browser and is brought up to date when the section opens.

const small = { font: "400 11.5px Archivo, sans-serif", color: C.inkSoft, lineHeight: 1.5 };
const mono = { font: "400 10.5px 'IBM Plex Mono', monospace", color: C.inkSoft };
const mini = { ...btnStyle(false), padding: "2px 8px", fontSize: 11 };
const input = { font: "500 12px Archivo, sans-serif", color: C.ink, background: "#fff", border: `1px solid ${C.rule}`, borderRadius: 3, padding: "3px 6px", boxSizing: "border-box" };
const badge = (color) => ({ font: "600 10px Archivo, sans-serif", color, border: `1px solid ${color}`, borderRadius: 8, padding: "0 6px", whiteSpace: "nowrap" });
const when = (iso) => (iso ? new Date(iso).toLocaleString() : "never");
const int = (v) => (String(v).trim() === "" ? undefined : Number.isInteger(Number(v)) ? Number(v) : undefined);

/** A crop of the hit's region from the cached page image (nothing if the page was never drawn). */
function HitCrop({ library, hit }) {
  const [img, setImg] = useState(null);
  useEffect(() => {
    let url = null, live = true;
    (async () => {
      for (const v of ["max2000", "max1600"]) {
        const c = await library.pageCache.get(hit.pageId, v);
        if (c && live) { url = URL.createObjectURL(new Blob([c.bytes], { type: c.mimeType })); setImg({ url, width: c.width, height: c.height }); return; }
      }
    })().catch(() => {});
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [library, hit.pageId]);
  if (!img || !hit.box) return <div style={{ width: 150, height: 60, flexShrink: 0, background: C.paper, border: `1px solid ${C.rule}`, borderRadius: 2 }} />;
  return <div data-testid="hit-crop" role="img" aria-label="Where it was found" style={cropStyle(img.url, hit.box, img.width, img.height, 150)} />;
}

/**
 * @param {{ library, project, onOpen: (hit) => void, client?: { call(op, args) } }} props
 */
export default function SearchSection({ library, project, onOpen, client: injected }) {
  const clientRef = useRef(null);
  const [status, setStatus] = useState(null);       // { docCount, builtAt, ... } | { error }
  const [busy, setBusy] = useState("");
  const [q, setQ] = useState("");
  const [f, setF] = useState({ fromYear: "", toYear: "", place: "", kind: "", projectOnly: false, confirmedOnly: false });
  const [result, setResult] = useState(null);        // { hits, ms, placeNotFound } | { error }
  const projectSourceIds = useMemo(() => (project?.sources ?? []).map((s) => s.librarySourceId).filter(Boolean), [project]);

  const client = () => (clientRef.current ??= injected ?? createSearchClient({ library }));
  // close the worker on unmount, and forget it, so a remount (React StrictMode in development) starts a new one
  useEffect(() => () => { if (!injected) { clientRef.current?.close(); clientRef.current = null; } }, [injected]);
  const call = async (label, op, args) => {
    setBusy(label);
    try { return await client().call(op, args); }
    finally { setBusy(""); }
  };
  const refresh = async (op = "update") => {
    try { setStatus(await call(op === "rebuild" ? "Rebuilding the index…" : "Updating the index…", op)); }
    catch (e) { setStatus({ error: e.message }); }
  };
  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const search = async (e) => {
    e?.preventDefault?.();
    if (!q.trim()) return;
    try {
      const r = await call("Searching…", "query", {
        q, fromYear: int(f.fromYear), toYear: int(f.toYear), place: f.place, sourceKinds: f.kind ? [f.kind] : [],
        sourceIds: f.projectOnly ? projectSourceIds : null, confirmedOnly: f.confirmedOnly, limit: 100,
      });
      setResult(r);
    } catch (err) { setResult({ error: err.message }); }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  return (
    <div data-testid="search-section">
      <div style={{ font: "700 13px Archivo, sans-serif", color: C.ink, marginBottom: 4 }}>Search</div>
      <div style={small}>
        Finds words and names in everything read so far: page text, your modern readings and the values in records.
        Spelling with or without diacritics, name variants you paired, and names that sound alike (Daitch–Mokotoff) all match.
        Values not yet confirmed are found and marked <em>proposed</em>; rejected values never are.
      </div>

      <form onSubmit={search} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", margin: "10px 0 6px" }}>
        <input aria-label="Search for" placeholder="a name, a place, a word… e.g. Loti, Stefan Hariton" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...input, flex: "1 1 260px", fontSize: 13 }} autoFocus />
        <button type="submit" style={{ ...btnStyle(true), padding: "3px 12px" }} disabled={!!busy || !q.trim()}>Search</button>
      </form>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", ...small }}>
        <label>Years <input aria-label="From year" placeholder="from" value={f.fromYear} onChange={set("fromYear")} style={{ ...input, width: 58 }} /> – <input aria-label="To year" placeholder="to" value={f.toYear} onChange={set("toYear")} style={{ ...input, width: 58 }} /></label>
        <label>Place <input aria-label="Place" placeholder="e.g. Prahova" value={f.place} onChange={set("place")} style={{ ...input, width: 120 }} /></label>
        <label>Source <select aria-label="Source kind" value={f.kind} onChange={set("kind")} style={input}><option value="">any kind</option>{SOURCE_KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
        <label title={projectSourceIds.length ? "" : "This project has no sources linked to the library yet"}><input type="checkbox" checked={f.projectOnly} onChange={set("projectOnly")} disabled={!projectSourceIds.length} /> only this project's sources</label>
        <label><input type="checkbox" checked={f.confirmedOnly} onChange={set("confirmedOnly")} /> confirmed only</label>
      </div>

      <div data-testid="index-status" style={{ ...mono, display: "flex", gap: 8, alignItems: "center", margin: "8px 0" }}>
        {busy ? <span>{busy}</span> : status?.error ? <span style={{ color: C.focus }}>Index error: {status.error}</span>
          : status ? <span>{status.docCount} {status.docCount === 1 ? "region" : "regions"} indexed · updated {when(status.builtAt)}</span> : <span>Preparing the index…</span>}
        <button style={mini} disabled={!!busy} onClick={() => refresh("rebuild")} title="Build the index again from all documents (it is also kept up to date automatically)">Rebuild index</button>
      </div>

      {result?.error && <div role="alert" style={{ ...small, color: C.focus }}>Search failed: {result.error}</div>}
      {result?.placeNotFound && <div role="status" style={small}>No place with that name in the library.</div>}
      {result?.hits && (
        <div data-testid="search-results">
          <div role="status" style={{ ...small, marginBottom: 6 }}>{result.hits.length === 0 ? "Nothing found." : `${result.hits.length} result${result.hits.length === 1 ? "" : "s"}${result.hits.length >= 100 ? " (first 100)" : ""}`}</div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {result.hits.map((h) => (
              <li key={h.id} data-testid="search-hit" style={{ display: "flex", gap: 10, padding: "8px 0", borderTop: `1px solid ${C.ruleFaint}`, cursor: "pointer" }}
                onClick={() => onOpen?.(h)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onOpen?.(h)}
                aria-label={`Open ${h.sourceTitle || h.fileName}, page ${h.pageIndex + 1}`}>
                <HitCrop library={library} hit={h} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ font: "600 12px Archivo, sans-serif", color: C.ink }}>
                    {h.sourceTitle || h.fileName} <span style={mono}>· page {h.pageIndex + 1}{h.pageLabel ? ` (${h.pageLabel})` : ""}{h.regionKind !== "page" ? ` · ${h.regionLabel || "box"}` : ""}</span>
                  </div>
                  <div data-testid="hit-snippet" style={{ font: "400 13px/1.5 Fraunces, Georgia, serif", color: C.ink, margin: "2px 0" }}>
                    {h.snippet.map((s, i) => (s.hit ? <mark key={i} style={{ background: "rgba(138,106,47,.25)", color: C.ink, padding: 0 }}>{s.text}</mark> : <span key={i}>{s.text}</span>))}
                  </div>
                  {h.shownNames?.length > 0 && <div style={small}>People: {h.shownNames.join(", ")}</div>}
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2 }}>
                    {h.reasons.map((r) => <span key={r} style={badge(C.slate)}>{r}</span>)}
                    {h.hasProposed && <span style={badge(C.rel[1])}>proposed values</span>}
                    {h.hasConfirmed && <span style={badge(C.rel[2])}>confirmed values</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
