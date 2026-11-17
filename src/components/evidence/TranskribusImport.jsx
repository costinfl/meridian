import React, { useRef, useState } from "react";
import { C, btnStyle } from "../../theme.js";
import { readExport, matchPages, importTranskribus, describeImport } from "../../ingest/transkribus/index.js";

// Import a Transkribus export (P7b.T4): pick the ZIP (or PAGE XML files), see how its pages match registered
// pages (by image file name, or by page order onto a document you pick), untick anything doubtful, import.

const small = { font: "400 11.5px Archivo, sans-serif", color: C.inkSoft, lineHeight: 1.5 };
const mono = { font: "400 10.5px 'IBM Plex Mono', monospace", color: C.inkSoft };
const mini = { ...btnStyle(false), padding: "2px 8px", fontSize: 11 };
const primary = { ...btnStyle(true), padding: "2px 8px", fontSize: 11 };
const input = { font: "500 12px Archivo, sans-serif", color: C.ink, background: "#fff", border: `1px solid ${C.rule}`, borderRadius: 3, padding: "2px 5px" };

const aspectNote = (a) => (a.ok ? "" : a.rotated ? "the export image is the page turned by 90°" : "the export image has a different shape");

/** @param {{ library, copies, disabled, onDone: (message) => void }} props */
export default function TranskribusImport({ library, copies, disabled, onDone }) {
  const fileRef = useRef(null);
  const [state, setState] = useState(null);    // { files, read, match, copyId, ticked }
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const rematch = async (files, read, copyId) => {
    const match = await matchPages({ library, exportPages: read.pages, copyId: copyId || null });
    const ticked = Object.fromEntries(match.matched.map((m, i) => [i, m.aspect.ok]));
    setState({ files, read, match, copyId, ticked });
  };
  const open = async (fileList) => {
    const files = [...fileList];
    setBusy("Reading the export…"); setError("");
    try {
      const read = await readExport(files);
      if (!read.pages.length) { setError(read.errors.length ? `No PAGE XML pages found (${read.errors[0].source}: ${read.errors[0].error}).` : "No PAGE XML pages found in the export."); setState(null); return; }
      await rematch(files, read, "");
    } catch (e) { setError(e.message); }
    finally { setBusy(""); }
  };
  const chooseDocument = async (copyId) => {
    setBusy("Matching…");
    try { await rematch(state.files, state.read, copyId); } finally { setBusy(""); }
  };
  const doImport = async () => {
    const chosen = state.match.matched.filter((_, i) => state.ticked[i]);
    setBusy("Importing…");
    try {
      const r = await importTranskribus({ library, matches: chosen, exportName: state.files.map((f) => f.name).join(", ") });
      const notImported = state.match.unmatched.length + (state.match.matched.length - chosen.length);
      setState(null);
      onDone(describeImport(r, notImported));
    } catch (e) { setError(e.message); }
    finally { setBusy(""); }
  };

  const nTicked = state ? Object.values(state.ticked).filter(Boolean).length : 0;
  const multiPage = (copies ?? []).filter((c) => !/\.(png|jpe?g|tiff?|webp|gif|bmp)$/i.test(c.fileName));

  return (
    <>
      <button style={mini} disabled={disabled || !!busy} onClick={() => fileRef.current?.click()} title="Import the text of handwritten pages read in Transkribus (Export → PAGE XML)">Import Transkribus export…</button>
      <input ref={fileRef} data-testid="transkribus-files" type="file" multiple accept=".zip,.xml" style={{ display: "none" }}
        onChange={(e) => { if (e.target.files?.length) open(e.target.files); e.target.value = ""; }} />
      {(state || error || busy) && (
        <div data-testid="transkribus-panel" style={{ flexBasis: "100%", border: `1px solid ${C.rule}`, borderRadius: 3, background: C.paper, padding: 8, margin: "6px 0" }}>
          <div style={{ font: "700 12px Archivo, sans-serif", color: C.ink, marginBottom: 4 }}>Transkribus export</div>
          {busy && <div style={small}>{busy}</div>}
          {error && <div role="alert" style={{ ...small, color: C.focus }}>{error}</div>}
          {state && (
            <>
              <div style={small}>
                {state.read.pages.length} page{state.read.pages.length === 1 ? "" : "s"} in the export{state.read.usedMets ? " (in the export's page order)" : ""}.
                Pages are matched by their image file name. For a PDF, or when names differ, choose the document and the pages are matched in order.
              </div>
              <label style={{ ...small, display: "block", margin: "4px 0" }}>Match by page order onto{" "}
                <select aria-label="Match by page order onto" value={state.copyId} onChange={(e) => chooseDocument(e.target.value)} style={input}>
                  <option value="">— match by file name —</option>
                  {multiPage.concat((copies ?? []).filter((c) => !multiPage.includes(c))).map((c) => <option key={c.id} value={c.id}>{c.fileName}{c.label ? ` · ${c.label}` : ""}</option>)}
                </select>
              </label>
              {state.match.warnings.map((w) => <div key={w} style={{ ...small, color: C.focus }}>{w}</div>)}
              {state.match.matched.length > 0 && (
                <ul data-testid="transkribus-matched" style={{ listStyle: "none", margin: "4px 0", padding: 0, maxHeight: 200, overflowY: "auto" }}>
                  {state.match.matched.map((m, i) => (
                    <li key={i} style={{ ...small, color: C.ink }}>
                      <label><input type="checkbox" checked={!!state.ticked[i]} onChange={(e) => setState({ ...state, ticked: { ...state.ticked, [i]: e.target.checked } })} />{" "}
                        {m.exportPage.file} → <strong>{m.copy.fileName}</strong>, page {m.page.pageIndex + 1} <span style={mono}>({m.via}{m.exportPage.parsed.lines.length ? `, ${m.exportPage.parsed.lines.length} lines` : ", no text"})</span>
                        {!m.aspect.ok && <span style={{ color: C.focus }}> — {aspectNote(m.aspect)}; tick only if it is the same scan</span>}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              {state.match.unmatched.length > 0 && (
                <details style={small} open={!state.match.matched.length}>
                  <summary style={{ cursor: "pointer" }}>{state.match.unmatched.length} not matched</summary>
                  <ul data-testid="transkribus-unmatched" style={{ margin: "2px 0 0 16px", padding: 0 }}>
                    {state.match.unmatched.map((u, i) => <li key={i}>{u.exportPage.file}: {u.reason}</li>)}
                  </ul>
                </details>
              )}
              {state.read.errors.length > 0 && <div style={small}>Skipped: {state.read.errors.map((e) => `${e.source} (${e.error})`).join("; ")}</div>}
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <button style={primary} disabled={!!busy || !nTicked} onClick={doImport}>Import {nTicked} page{nTicked === 1 ? "" : "s"}</button>
                <button style={mini} disabled={!!busy} onClick={() => { setState(null); setError(""); }}>Cancel</button>
              </div>
            </>
          )}
          {!state && error && <button style={{ ...mini, marginTop: 4 }} onClick={() => setError("")}>Close</button>}
        </div>
      )}
    </>
  );
}
