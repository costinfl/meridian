import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C, btnStyle } from "../../theme.js";
import { uncertainSpans, activeAnnotations } from "../../evidence/domain/reading.js";
import { needsReview } from "../../ingest/pipeline.js";

// Review text (P5.T7): the page image beside its text. The transcription is what the machine read and is never
// changed. The modern reading is the researcher's own text: fragments in [brackets] are uncertain; selecting a
// fragment lets you write the correct text and cite where you know it from (a link and a note). Every save is a
// new version; earlier versions stay in the history.

const small = { font: "400 11.5px Archivo, sans-serif", color: C.inkSoft, lineHeight: 1.5 };
const mono = { font: "400 10.5px 'IBM Plex Mono', monospace", color: C.inkSoft };
const mini = { ...btnStyle(false), padding: "2px 8px", fontSize: 11 };
const primary = { ...btnStyle(true), padding: "2px 8px", fontSize: 11 };
const field = { font: "500 12px Archivo, sans-serif", color: C.ink, background: "#fff", border: `1px solid ${C.rule}`, borderRadius: 3, padding: "3px 6px", width: "100%", boxSizing: "border-box" };
const textBox = { font: "400 14px/1.7 Fraunces, Georgia, serif", color: C.ink, whiteSpace: "pre-wrap", background: "#fff", border: `1px solid ${C.rule}`, borderRadius: 3, padding: "10px 12px", minHeight: 120 };
const tabStyle = (on) => ({ ...btnStyle(on), padding: "3px 10px", fontSize: 11.5 });
const UNCERTAIN_BG = "rgba(138,48,51,.13)";
const ANNOTATED_BG = "rgba(52,99,92,.14)";

/** Split text into plain, uncertain ([…]) and annotated segments. Annotations win over brackets they overlap. */
export function segmentsOf(text, annotations = []) {
  const marks = activeAnnotations(annotations).filter((a) => a.end > a.start).map((a) => ({ start: a.start, end: a.end, type: "annotated", annotation: a }));
  for (const u of uncertainSpans(text)) if (!marks.some((m) => u.start < m.end && m.start < u.end)) marks.push({ start: u.start, end: u.end, type: "uncertain" });
  marks.sort((a, b) => a.start - b.start);
  const out = [];
  let at = 0;
  for (const m of marks) {
    if (m.start < at) continue;
    if (m.start > at) out.push({ start: at, end: m.start, type: "plain" });
    out.push(m);
    at = m.end;
  }
  if (at < text.length) out.push({ start: at, end: text.length, type: "plain" });
  return out;
}

/**
 * Offset in the reading text of a DOM selection boundary (node, offset). Segment spans carry data-start; the
 * position inside a span is measured with a Range, so text-node and element boundaries (double/triple click,
 * select-all) both work. A boundary on the container itself counts the segments before it.
 */
function offsetOf(container, node, offset) {
  let el = node?.nodeType === 3 ? node.parentElement : node;
  while (el && el !== container && el.dataset?.start == null) el = el.parentElement;
  if (!el) return null;
  if (el === container) {
    let pos = 0;
    for (const child of [...container.childNodes].slice(0, offset)) if (child.dataset?.start != null) pos = Number(child.dataset.start) + child.textContent.length;
    return pos;
  }
  const r = document.createRange();
  r.setStart(el, 0); r.setEnd(node, offset);
  return Number(el.dataset.start) + r.toString().length;
}

const pct = (c) => (c == null ? "—" : `${Math.round(c * 100)}%`);
const when = (iso) => (iso ? new Date(iso).toLocaleString() : "");

/**
 * @param {{ library, copy, loadImage: (page) => Promise<{bytes, mimeType}|null>, onClose: () => void }} props
 */
export default function TextReview({ library, copy, loadImage, onClose }) {
  const [pages, setPages] = useState([]);
  const [idx, setIdx] = useState(0);
  const [data, setData] = useState(null);        // { region, transcription, transcriptionRun, reading, history }
  const [tab, setTab] = useState("reading");
  const [selection, setSelection] = useState(null); // { start, end }
  const [form, setForm] = useState({ after: "", url: "", note: "" });
  const [rewrite, setRewrite] = useState(null);  // text being typed in "Edit whole text", or null
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [image, setImage] = useState({ url: null, state: "idle" });
  const [zoom, setZoom] = useState(1);
  const textRef = useRef(null);
  const page = pages[idx] ?? null;
  // side by side on wide screens; image above text on narrow ones (each pane scrolls on its own when side by side)
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 900);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 900);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => { library.pages.listPages(copy.id).then(setPages).catch((e) => setMessage(`Failed: ${e.message}`)); }, [library, copy.id]);

  const load = useCallback(async () => {
    if (!page) return;
    const region = await library.pages.wholePageRegion(page.id);
    if (!region) { setData({ region: null }); return; }
    const transcription = await library.textLayers.current(region.id);
    const transcriptionRun = transcription ? await library.runs.getRun(transcription.runId) : null;
    const reading = await library.textLayers.current(region.id, "reading");
    const history = await library.textLayers.listByRegion(region.id, "reading");
    setData({ region, transcription, transcriptionRun, reading, history });
  }, [library, page]);

  useEffect(() => { setSelection(null); setRewrite(null); setMessage(""); load().catch((e) => setMessage(`Failed: ${e.message}`)); }, [load]);

  useEffect(() => {
    if (!page || !loadImage) return undefined;
    let url = null, live = true;
    setImage({ url: null, state: "loading" });
    loadImage(page).then((img) => {
      if (!live) return;
      if (!img) { setImage({ url: null, state: "none" }); return; }
      url = URL.createObjectURL(new Blob([img.bytes], { type: img.mimeType }));
      setImage({ url, state: "ready" });
    }).catch((e) => live && setImage({ url: null, state: `error: ${e.message}` }));
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [page, loadImage]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const act = async (fn, okMessage) => {
    setBusy(true); setMessage("");
    try { await fn(); await load(); setMessage(okMessage); return true; }
    catch (e) { setMessage(`Not saved: ${e.message}`); return false; }
    finally { setBusy(false); }
  };

  const reading = data?.reading ?? null;
  const text = reading?.originalText ?? "";
  const segments = useMemo(() => segmentsOf(text, reading?.annotations ?? []), [text, reading]);
  const corrections = useMemo(() => [...(reading?.annotations ?? [])].reverse(), [reading]);

  const select = (start, end) => {
    if (end <= start) return;
    setSelection({ start, end });
    const frag = text.slice(start, end);
    setForm({ after: frag, url: "", note: "" });
  };
  const onMouseUp = () => {
    const sel = window.getSelection?.();
    if (!sel || sel.isCollapsed || !textRef.current) return;
    if (!textRef.current.contains(sel.anchorNode) || !textRef.current.contains(sel.focusNode)) return;
    const a = offsetOf(textRef.current, sel.anchorNode, sel.anchorOffset), b = offsetOf(textRef.current, sel.focusNode, sel.focusOffset);
    if (a == null || b == null) return;
    select(Math.min(a, b), Math.max(a, b));
  };

  const start = () => act(() => library.textLayers.startReading({ regionId: data.region.id }), "Reading started from the transcription. The transcription itself is unchanged.");
  const saveCorrection = async () => {
    const ok = await act(() => library.textLayers.correctReading({ readingId: reading.id, start: selection.start, end: selection.end, after: form.after, url: form.url, note: form.note }),
      "Correction saved as a new version.");
    if (ok) setSelection(null);
  };
  const saveRewrite = async () => {
    const ok = await act(() => library.textLayers.rewriteReading({ readingId: reading.id, text: rewrite }), "Text saved as a new version.");
    if (ok) setRewrite(null);
  };

  const doubtful = needsReview(data?.transcription);
  const run = data?.transcriptionRun;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(25,32,28,.55)", zIndex: 260, display: "flex", alignItems: "stretch", justifyContent: "center", padding: "2vh 1vw" }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label={`Review text: ${copy.fileName}`} data-testid="text-review" onMouseDown={(e) => e.stopPropagation()}
        style={{ background: C.paperHi, border: `1px solid ${C.ink}`, borderRadius: 4, width: 1280, maxWidth: "100%", display: "flex", flexDirection: "column", boxShadow: "0 12px 40px rgba(0,0,0,.3)", overflow: "hidden" }}>

        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: `1px solid ${C.rule}`, flexWrap: "wrap" }}>
          <div style={{ font: "700 15px Fraunces, Georgia, serif", color: C.ink, flex: "1 1 200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Review text — {copy.fileName}</div>
          {pages.length > 1 && (
            <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button style={mini} disabled={idx === 0} onClick={() => setIdx(idx - 1)} aria-label="Previous page">‹</button>
              <span style={mono}>page {idx + 1} / {pages.length}{page?.label ? ` (${page.label})` : ""}</span>
              <button style={mini} disabled={idx >= pages.length - 1} onClick={() => setIdx(idx + 1)} aria-label="Next page">›</button>
            </span>
          )}
          <button style={mini} onClick={onClose}>Close</button>
        </div>

        <div style={{ display: "flex", flex: 1, minHeight: 0, flexDirection: narrow ? "column" : "row", overflowY: narrow ? "auto" : "hidden" }}>
          {/* page image */}
          <div style={{ flex: narrow ? "0 0 55vh" : "1 1 0", minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", borderRight: narrow ? "none" : `1px solid ${C.rule}`, borderBottom: narrow ? `1px solid ${C.rule}` : "none" }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "6px 10px", borderBottom: `1px solid ${C.ruleFaint}` }}>
              <span style={small}>Page image</span>
              <button style={mini} onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} aria-label="Zoom out">−</button>
              <span style={mono}>{Math.round(zoom * 100)}%</span>
              <button style={mini} onClick={() => setZoom((z) => Math.min(4, z + 0.25))} aria-label="Zoom in">+</button>
            </div>
            <div style={{ flex: 1, overflow: "auto", background: C.paper, padding: 8 }}>
              {image.state === "ready" && <img src={image.url} alt={`Page ${idx + 1} of ${copy.fileName}`} style={{ width: `${zoom * 100}%`, display: "block" }} />}
              {image.state === "loading" && <div style={small}>Loading the page image…</div>}
              {image.state === "none" && <div style={small}>This document has no page image (for example a DOCX).</div>}
              {image.state.startsWith("error") && <div style={{ ...small, color: C.focus }}>The page image could not be shown ({image.state.slice(7)}).</div>}
            </div>
          </div>

          {/* text */}
          <div style={{ flex: narrow ? "0 0 auto" : "1 1 0", minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", overflow: narrow ? "visible" : "auto", padding: "8px 14px 14px" }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }} role="tablist">
              <button role="tab" aria-selected={tab === "reading"} style={tabStyle(tab === "reading")} onClick={() => setTab("reading")}>Modern reading</button>
              <button role="tab" aria-selected={tab === "transcription"} style={tabStyle(tab === "transcription")} onClick={() => setTab("transcription")}>Transcription (as read)</button>
            </div>

            {!data ? <div style={small}>Loading…</div> : !data.region ? <div style={small}>This page has no text region yet. Read the document first.</div> : tab === "transcription" ? (
              <div data-testid="transcription-tab">
                <div style={{ ...mono, marginBottom: 6 }}>
                  {data.transcription
                    ? <>{run ? `${run.processor}${run.processorVersion ? ` ${run.processorVersion}` : ""}` : "unknown run"} · {when(data.transcription.createdAt)} · confidence {pct(data.transcription.confidence)}</>
                    : "No transcription: this page has not been read (or waits for handwriting recognition)."}
                </div>
                {doubtful && <div style={{ ...small, color: C.focus, marginBottom: 6 }}>Needs review: the OCR confidence is low or the text does not look like words. Handwriting is not read well by OCR.</div>}
                <div style={{ ...textBox, background: C.paper }} data-testid="transcription-text">{data.transcription?.originalText || <span style={small}>(empty)</span>}</div>
                <div style={{ ...small, marginTop: 6 }}>This is exactly what the machine read. It is never changed; corrections go into the modern reading.</div>
              </div>
            ) : !reading ? (
              <div>
                <div style={small}>
                  The modern reading is your own text for this page. It starts as a copy of the transcription
                  {data.transcription ? "" : " (empty, because this page has no transcription: type it in)"}; the transcription stays as it is.
                  Write uncertain parts in [square brackets].
                </div>
                {doubtful && <div style={{ ...small, color: C.focus, marginTop: 6 }}>The transcription of this page looks doubtful (confidence {pct(data.transcription?.confidence)}).</div>}
                <button style={{ ...primary, marginTop: 8 }} disabled={busy} onClick={start}>Start reading from transcription</button>
              </div>
            ) : rewrite != null ? (
              <div>
                <textarea aria-label="Reading text" value={rewrite} onChange={(e) => setRewrite(e.target.value)} style={{ ...textBox, width: "100%", boxSizing: "border-box", minHeight: 260, resize: "vertical" }} />
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  <button style={primary} disabled={busy} onClick={saveRewrite}>Save text</button>
                  <button style={mini} disabled={busy} onClick={() => setRewrite(null)}>Cancel</button>
                </div>
                <div style={{ ...small, marginTop: 4 }}>Typed changes have no source link. For a sourced correction, cancel and select the fragment instead.</div>
              </div>
            ) : (
              <div data-testid="reading-tab">
                <div style={{ ...small, marginBottom: 6 }}>
                  Select a fragment (or click a <span style={{ background: UNCERTAIN_BG }}>[bracketed]</span> one) to correct it and cite where you know it from.
                  <span style={{ background: ANNOTATED_BG, marginLeft: 6 }}>Corrected</span> text shows its source on hover.
                </div>
                <div ref={textRef} data-testid="reading-text" style={textBox} onMouseUp={onMouseUp}>
                  {segments.map((s) => {
                    const t = text.slice(s.start, s.end);
                    if (s.type === "plain") return <span key={s.start} data-start={s.start}>{t}</span>;
                    if (s.type === "uncertain") {
                      return <span key={s.start} data-start={s.start} role="button" tabIndex={0} title="Uncertain: click to correct"
                        onClick={() => select(s.start, s.end)} onKeyDown={(e) => e.key === "Enter" && select(s.start, s.end)}
                        style={{ background: UNCERTAIN_BG, borderRadius: 2, cursor: "pointer" }}>{t}</span>;
                    }
                    const a = s.annotation;
                    return (
                      <React.Fragment key={s.start}>
                        <span data-start={s.start} data-testid="annotated" title={`was: ${a.before}${a.note ? `\nnote: ${a.note}` : ""}${a.url ? `\nsource: ${a.url}` : ""}`}
                          onClick={() => select(s.start, s.end)} style={{ background: ANNOTATED_BG, borderBottom: `1px solid ${C.rel[2]}`, cursor: "pointer" }}>{t}</span>
                        {a.url && <a href={a.url} target="_blank" rel="noopener noreferrer" title={a.url} style={{ font: "400 10px Archivo, sans-serif", color: C.rel[2], textDecoration: "none", marginLeft: 1, userSelect: "none" }}>↗</a>}
                      </React.Fragment>
                    );
                  })}
                  {!text && <span style={small}>(empty — use Edit whole text)</span>}
                </div>

                {selection ? (
                  <div data-testid="correction-form" style={{ marginTop: 8, padding: 8, border: `1px solid ${C.rule}`, borderRadius: 3, background: C.paper, display: "grid", gap: 6 }}>
                    <div style={small}>Selected: <strong style={{ color: C.ink }}>“{text.slice(selection.start, selection.end)}”</strong></div>
                    <label style={small}>Correct text
                      <input aria-label="Correct text" value={form.after} onChange={(e) => setForm({ ...form, after: e.target.value })} style={field} autoFocus />
                    </label>
                    <label style={small}>Source link (optional) — where you know this from
                      <input aria-label="Source link" placeholder="https://…" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} style={field} />
                    </label>
                    <label style={small}>Note (optional)
                      <input aria-label="Note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} style={field} />
                    </label>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button style={primary} disabled={busy} onClick={saveCorrection}>Save correction</button>
                      <button style={mini} disabled={busy} onClick={() => setSelection(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                    <button style={mini} disabled={busy} onClick={() => setRewrite(text)}>Edit whole text</button>
                  </div>
                )}

                {corrections.length > 0 && (
                  <div style={{ marginTop: 12 }} data-testid="corrections">
                    <div style={{ font: "700 12px Archivo, sans-serif", color: C.ink, marginBottom: 4 }}>Corrections ({corrections.length})</div>
                    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                      {corrections.map((a) => (
                        <li key={a.id} style={{ ...small, padding: "3px 0", borderBottom: `1px solid ${C.ruleFaint}`, opacity: a.replacedBy ? 0.6 : 1 }}>
                          <span style={{ textDecoration: "line-through" }}>{a.before || "(nothing)"}</span> → <strong style={{ color: C.ink }}>{a.after || "(removed)"}</strong>
                          {a.note ? <> · {a.note}</> : null}
                          {a.url ? <> · <a href={a.url} target="_blank" rel="noopener noreferrer" style={{ color: C.rel[2] }}>source</a></> : <> · no source</>}
                          {a.replacedBy ? <> · later changed</> : null}
                          <span style={{ ...mono, marginLeft: 6 }}>{when(a.createdAt)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <details style={{ marginTop: 10 }} data-testid="history">
                  <summary style={{ ...small, cursor: "pointer" }}>History ({data.history.length} version{data.history.length === 1 ? "" : "s"})</summary>
                  <ol style={{ margin: "4px 0 0 18px", padding: 0 }}>
                    {data.history.map((v) => (
                      <li key={v.id} style={{ ...small, marginBottom: 4 }}>
                        <span style={mono}>{when(v.createdAt)}</span>{v.id === reading.id ? " (current)" : ""}
                        <div style={{ ...mono, whiteSpace: "pre-wrap", color: C.ink }}>{v.originalText.length > 400 ? `${v.originalText.slice(0, 400)}…` : v.originalText}</div>
                      </li>
                    ))}
                  </ol>
                </details>
              </div>
            )}
            {message && <div role="status" data-testid="review-status" style={{ ...small, marginTop: 8, color: message.startsWith("Not saved") || message.startsWith("Failed") ? C.focus : C.ink }}>{message}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
