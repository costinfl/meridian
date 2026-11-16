import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C, btnStyle } from "../../theme.js";
import { formatBytes } from "../../storage/persistence.js";
import {
  isFolderAccessSupported, linkFolder, getLinkedFolder, unlinkFolder, folderPermission, walkFolder,
  scanEntries, importFiles, assignSource, ingestCopy, listRunsWithItems, rerunTargetOf, textStatusOf,
} from "../../ingest/index.js";
import { getPageImage, loadCopyBytes, openDocument } from "../../ingest/documents.js";
import TextReview from "./TextReview.jsx";
import { proposalsByPage, recordsOfPage } from "../../evidence/index.js";

// Documents (Phase 5): link a folder or add files, scan them into the library, read their text (embedded text
// or OCR), and see every processing run with its failures. Heavy libraries load only when "Read" is used.

const small = { font: "400 11.5px Archivo, sans-serif", color: C.inkSoft, lineHeight: 1.5 };
const mono = { font: "400 10.5px 'IBM Plex Mono', monospace", color: C.inkSoft };
const mini = { ...btnStyle(false), padding: "2px 8px", fontSize: 11 };
const field = { font: "500 11.5px Archivo, sans-serif", color: C.ink, background: "#fff", border: `1px solid ${C.rule}`, borderRadius: 3, padding: "2px 6px", width: 150 };

/** AI extraction services, loaded on first use (the SDK and the image code stay out of the panel's first load). */
async function defaultAiServices() {
  const [ex, img] = await Promise.all([import("../../extract/index.js"), import("../../extract/image.browser.js")]);
  return { ...ex, prepareImage: img.prepareImageForLlm };
}

/** Where an AI call would go: "Anthropic Claude claude-opus-5-5". */
const sendToOf = (ai, settings) => `${ai.PROVIDERS[settings.provider].label}${settings.models[settings.provider] ? ` ${settings.models[settings.provider]}` : ""}`;

/** One line about an extraction or a dry run. */
export function describeExtraction(s) {
  const extra = [];
  if (s.alreadyExtracted) extra.push(`${s.alreadyExtracted} already extracted (use Extract again)`);
  if (s.overLimit) extra.push(`${s.overLimit} over the page limit, run again for the rest`);
  const tail = extra.length ? ` ${extra.join("; ")}.` : "";
  if (s.dryRun) {
    if (!s.pages.length) return `Dry run: nothing to send.${tail}`;
    const tokens = s.pages.reduce((n, p) => n + p.estimatedInputTokens, 0);
    const kb = Math.round(s.pages.reduce((n, p) => n + (p.image?.bytes ?? 0), 0) / 1024);
    return `Dry run: would send ${s.pages.length} page${s.pages.length === 1 ? "" : "s"} (images ${kb} kB, about ${tokens.toLocaleString("en")} input tokens). Nothing was sent.${tail}`;
  }
  const ok = s.pages.filter((p) => p.status === "succeeded"), bad = s.pages.filter((p) => p.status === "failed");
  const recs = ok.reduce((n, p) => n + p.records, 0), claims = ok.reduce((n, p) => n + p.assertions, 0), skipped = ok.reduce((n, p) => n + p.skippedRejected, 0);
  let msg = `Extracted ${recs} record${recs === 1 ? "" : "s"} with ${claims} proposed values from ${ok.length} page${ok.length === 1 ? "" : "s"}`;
  if (skipped) msg += ` (${skipped} you rejected before were not proposed again)`;
  if (bad.length) msg += `; ${bad.length} failed: ${bad[0].error}`;
  return `${msg}${s.cancelled ? ". Stopped" : ""}.${tail}`;
}

async function defaultServices() {
  const [{ browserEngines }, { createBrowserOcr }] = await Promise.all([import("../../ingest/engines.browser.js"), import("../../ingest/ocrEngine.browser.js")]);
  return { engines: browserEngines(), ocr: createBrowserOcr() };
}

function summarize(r) {
  const parts = [`${r.added.length} new`, `${r.known} already known`];
  if (r.moved?.length) parts.push(`${r.moved.length} moved`);
  if (r.flagged?.length) parts.push(`${r.flagged.length} flagged as a possible new version`);
  if (r.sameContentTwice?.length) parts.push(`${r.sameContentTwice.length} identical duplicates`);
  if (r.missing?.length) parts.push(`${r.missing.length} no longer in the folder`);
  if (r.skipped?.length) parts.push(`${r.skipped.length} skipped (${[...new Set(r.skipped.map((s) => s.path.split(".").pop()))].join(", ")})`);
  if (r.warnings?.length) parts.push(`${r.warnings.length} sidecar warnings`);
  return `${r.cancelled ? "Stopped. " : ""}${parts.join(", ")}.`;
}

/** @param {{ storage, library, services?: () => Promise<{engines, ocr}>, picker?: Function }} props  (services/picker injectable for tests) */
export default function DocumentsSection({ storage, library, services = defaultServices, aiServices = defaultAiServices, picker }) {
  const [folder, setFolder] = useState(null);          // { handle, name } or null
  const [copies, setCopies] = useState([]);
  const [sources, setSources] = useState({});
  const [status, setStatus] = useState({});            // copyId -> { pages, withText }
  const [runs, setRuns] = useState([]);
  const [cache, setCache] = useState({ entries: 0, bytes: 0 });
  const [busy, setBusy] = useState(null);              // { label, progress }
  const [message, setMessage] = useState("");
  const [titles, setTitles] = useState({});            // copyId -> source title being typed
  const [reviewing, setReviewing] = useState(null);    // { copy, pageId?, tab? } open in the page workspace
  const abortRef = useRef(null);
  const svcRef = useRef(null);
  const fileRef = useRef(null);
  const supported = picker ? true : isFolderAccessSupported();

  const refresh = useCallback(async () => {
    const all = (await library.copies.listCurrent()).sort((a, b) => a.fileName.localeCompare(b.fileName));
    const src = Object.fromEntries((await library.sources.list()).map((s) => [s.id, s]));
    setCopies(all); setSources(src);
    const st = await textStatusOf({ library, copyIds: all.map((c) => c.id) });
    for (const c of all) {
      const waiting = await proposalsByPage(library, c.id, recordsOfPage);
      st[c.id].proposed = waiting.reduce((m, w) => m + w.proposed, 0);
      st[c.id].firstProposalPageId = waiting[0]?.page.id ?? null;
    }
    setStatus(st);
    setRuns(await listRunsWithItems({ library, limit: 8 }));
    setCache(await library.pageCache.stats());
  }, [library]);

  useEffect(() => { getLinkedFolder(storage).then(setFolder).catch(() => {}); refresh().catch(() => {}); }, [storage, refresh]);
  useEffect(() => () => { abortRef.current?.abort(); svcRef.current?.ocr?.terminate?.(); }, []);

  const run = async (label, fn) => {
    const ctl = new AbortController(); abortRef.current = ctl;
    setBusy({ label, progress: "" }); setMessage("");
    let msg = "";
    try { msg = await fn(ctl.signal, (progress) => setBusy({ label, progress })); }
    catch (err) { if (err?.name !== "AbortError") { console.error("Meridian documents:", err); msg = `Failed: ${err.message}`; } }
    await refresh().catch(() => {});      // refresh first, so the message and the list never disagree
    abortRef.current = null; setBusy(null); setMessage(msg);
  };
  // each click is a fresh attempt: forget an earlier OCR load failure (for example after going back online)
  const getServices = async () => { const svc = (svcRef.current ??= await services()); svc.ocr?.reset?.(); return svc; };
  const handleFor = async () => {
    if (!folder?.handle) return null;
    return (await folderPermission(folder.handle, { request: true })) === "granted" ? folder.handle : null;
  };

  const doLink = () => run("Linking folder", async () => {
    const handle = await linkFolder({ storage, picker });
    setFolder(await getLinkedFolder(storage));
    return `Linked "${handle.name}". Scan it to register its documents.`;
  });
  const doUnlink = () => run("Unlinking", async () => { await unlinkFolder(storage); setFolder(null); return "Folder unlinked. Documents already registered stay in the library."; });
  const doScan = () => run("Scanning", async (signal, progress) => {
    const handle = await handleFor();
    if (!handle) throw new Error("Permission to read the folder was not granted");
    const r = await scanEntries({ library, entries: walkFolder(handle), signal, onProgress: (p) => progress(`${p.done}/${p.total} ${p.path}`) });
    return `Scan: ${summarize(r)}`;
  });
  const addFiles = (files) => run("Adding files", async (signal, progress) => {
    const r = await importFiles({ library, storage, files: [...files], signal, onProgress: (p) => progress(`${p.done}/${p.total} ${p.path}`) });
    return `Added: ${summarize(r)}`;
  });

  const readCopies = (list, options = {}) => run("Reading", async (signal, progress) => {
    const svc = await getServices();
    const needsFolder = list.some((c) => c.storage.mode === "folder");
    const folderHandle = needsFolder ? await handleFor() : null;
    let ok = 0, failed = 0, waiting = 0;
    for (const copy of list) {
      if (signal.aborted) break;
      const s = await ingestCopy({ library, storage, copyId: copy.id, folderHandle, engines: svc.engines, ocr: svc.ocr, signal, ...options,
        onProgress: (p) => progress(`${copy.fileName}: ${p.stage} ${p.done}/${p.total}`) });
      for (const p of s.pages) { if (p.status === "succeeded") ok++; else if (p.status === "failed") failed++; else if (p.status === "awaiting-htr") waiting++; }
    }
    return `Read ${ok} pages${failed ? `, ${failed} failed (see runs below)` : ""}${waiting ? `, ${waiting} handwritten pages wait for HTR` : ""}${signal.aborted ? ". Stopped." : "."}`;
  });
  const rerun = (itemId) => run("Re-running page", async (signal, progress) => {
    const t = await rerunTargetOf({ library, itemId });
    if (t.processor === "llm-reading") {
      return (await runReading({ copy: await library.copies.get(t.copyId), pageIds: [t.pageId], force: true, signal })).message;
    }
    if (t.processor === "llm-extraction") {
      const regionId = (await library.runs.getRun((await library.runs.getItem(itemId)).runId))?.parameters?.regionId ?? null;
      if (!regionId) throw new Error("This extraction was not made on a region; draw a box on the page and use Extract with AI");
      const s = await runExtraction({ copy: await library.copies.get(t.copyId), regionId, force: true, signal, onProgress: (p) => progress(`${p.done}/${p.total}`) });
      return describeExtraction(s);
    }
    const svc = await getServices();
    const copy = await library.copies.get(t.copyId);
    const folderHandle = copy.storage.mode === "folder" ? await handleFor() : null;
    const s = await ingestCopy({ library, storage, copyId: t.copyId, folderHandle, engines: svc.engines, ocr: svc.ocr, signal, pageIds: [t.pageId], processor: t.processor ?? undefined, force: true,
      onProgress: (p) => progress(`${p.stage} ${p.done}/${p.total}`) });
    return s.pages[0]?.status === "succeeded" ? "Page read." : `Still failing: ${s.pages[0]?.error ?? "unknown error"}`;
  });

  const setSource = (copy) => run("Saving", async () => {
    const { source } = await assignSource({ library, copyId: copy.id, title: titles[copy.id] });
    setTitles((t) => ({ ...t, [copy.id]: "" }));
    return `"${copy.fileName}" belongs to "${source.title}".`;
  });
  const resolve = (copy, action) => run("Saving", async () => {
    await library.copies.resolveDuplicate(copy.id, action);
    return action === "replace" ? "The new file replaces the old one. Evidence read from the old file is kept and should be re-checked." : "Both files are kept.";
  });
  const clearCache = () => run("Clearing", async () => `Removed ${await library.pageCache.clear()} cached page images. They are rebuilt when needed.`);

  // page image for Review text: the image OCR used (cached), else render it now and cache it
  const loadImage = useCallback(async (page) => {
    for (const variant of ["max2000", "max1600"]) { const hit = await library.pageCache.get(page.id, variant); if (hit) return hit; }
    const copy = await library.copies.get(page.copyId);
    const svc = await getServices();
    const folderHandle = copy.storage.mode === "folder" ? await handleFor() : null;
    const doc = await openDocument({ fileName: copy.fileName, bytes: await loadCopyBytes({ storage, copy, folderHandle }), engines: svc.engines });
    try { return await getPageImage({ library, page, doc, maxSide: 2000 }); } finally { await doc.close().catch(() => {}); }
  }, [library, storage, folder]); // getServices and handleFor read refs and the folder
  // AI extraction (P6.T3): the provider, model, key and page limit come from AI settings (device only)
  const runExtraction = useCallback(async ({ copy, regionId = null, pageIds, force = false, dryRun = false, onProgress, signal }) => {
    const ai = await aiServices();
    const settings = await ai.getAiSettings(storage);
    const missing = ai.missingSetup(settings);
    if (!dryRun && missing) throw new Error(missing);
    const client = dryRun ? null : ai.clientFor(settings);
    // AI extraction reads only a box the researcher drew (review answer b)
    const s = await ai.extractCopy({ library, copy, client, loadImage, prepareImage: ai.prepareImage, regionId, pageIds, force, dryRun, requireRegion: true, maxPages: settings.maxPages, onProgress, signal });
    return { ...s, sendTo: sendToOf(ai, settings), missing };
  }, [aiServices, storage, library, loadImage]);
  const runReading = useCallback(async ({ copy, pageIds, force = false, dryRun = false, onProgress, signal }) => {
    const ai = await aiServices();
    const settings = await ai.getAiSettings(storage);
    const missing = ai.missingSetup(settings);
    if (!dryRun && missing) throw new Error(missing);
    const client = dryRun ? null : ai.clientFor(settings);
    const s = await ai.readPagesWithAi({ library, copy, client, loadImage, prepareImage: ai.prepareImage, pageIds, force, dryRun, maxPages: settings.maxPages, onProgress, signal });
    return { summary: { ...s, sendTo: sendToOf(ai, settings), missing }, message: ai.describeReading(s) };
  }, [aiServices, storage, library, loadImage]);

  const closeReview = useCallback(() => { setReviewing(null); refresh().catch(() => {}); }, [refresh]);

  const totalProposed = useMemo(() => Object.values(status).reduce((n, s) => n + (s.proposed ?? 0), 0), [status]);
  const unread = useMemo(() => copies.filter((c) => { const s = status[c.id]; return !s || s.pages === 0 || s.withText < s.pages; }), [copies, status]);
  const pageName = useCallback((pageId) => pageId.slice(0, 8), []);

  return (
    <div data-testid="documents-section" style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.rule}` }}
      onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files); }}>
      <div style={{ font: "700 12.5px Archivo, sans-serif", color: C.ink, marginBottom: 4 }}>Documents</div>
      <div style={small}>
        Register your scans and documents (PDF, DOCX, JPG, PNG), then read their text. Reading uses the text inside the file when
        it is good, and OCR otherwise. Nothing is uploaded: it all happens in this browser.
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", margin: "8px 0" }}>
        {supported ? (folder ? (
          <>
            <span style={small}>Folder: <strong style={{ color: C.ink }}>{folder.name}</strong></span>
            <button style={mini} disabled={!!busy} onClick={doScan}>Scan folder</button>
            <button style={mini} disabled={!!busy} onClick={doUnlink}>Unlink</button>
          </>
        ) : <button style={mini} disabled={!!busy} onClick={doLink}>Link documents folder</button>)
          : <span style={small}>This browser cannot link a folder (use Chrome or Edge). You can still add files.</span>}
        <button style={mini} disabled={!!busy} onClick={() => fileRef.current?.click()}>Add files…</button>
        <input ref={fileRef} data-testid="doc-files" type="file" multiple accept=".pdf,.docx,.jpg,.jpeg,.png,.tif,.tiff" style={{ display: "none" }}
          onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ""; }} />
        {totalProposed > 0 && <span data-testid="proposals-waiting" style={{ ...small, color: C.rel[1] }}>{totalProposed} proposed values waiting for review</span>}
        {unread.length > 0 && <button style={{ ...mini, ...btnStyle(true), padding: "2px 8px", fontSize: 11 }} disabled={!!busy} onClick={() => readCopies(unread)}>Read {unread.length} unread</button>}
      </div>

      {busy && (
        <div role="progressbar" aria-label={busy.label} style={{ ...small, display: "flex", gap: 8, alignItems: "center", color: C.ink }}>
          <span>{busy.label}… {busy.progress}</span>
          <button style={mini} onClick={() => abortRef.current?.abort()}>Cancel</button>
        </div>
      )}
      {message && !busy && <div role="status" data-testid="documents-status" style={{ ...small, color: C.ink }}>{message}</div>}

      {copies.length > 0 && (
        <ul data-testid="copy-list" style={{ listStyle: "none", margin: "8px 0 0", padding: 0, maxHeight: 190, overflowY: "auto", border: `1px solid ${C.rule}`, borderRadius: 3 }}>
          {copies.map((c) => {
            const s = status[c.id] ?? { pages: 0, withText: 0 };
            const src = c.sourceId ? sources[c.sourceId] : null;
            return (
              <li key={c.id} style={{ padding: "4px 6px", borderBottom: `1px solid ${C.ruleFaint}` }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ font: "600 12px Archivo, sans-serif", color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.storage.path ?? c.fileName}>{c.fileName}{c.label ? ` · ${c.label}` : ""}</span>
                  <span style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                    <span style={mono}>{s.pages ? `${s.withText}/${s.pages} pages read` : "not read"}</span>
                    {s.needsReview > 0 && <span data-testid="needs-review" title="OCR confidence is low or the text does not look like words" style={{ ...mono, color: C.focus }}>{s.needsReview === s.pages ? "needs review" : `${s.needsReview} need review`}</span>}
                    {s.withReading > 0 && <span style={mono}>{s.withReading} reviewed</span>}
                    {s.pages > 0 && <button style={mini} disabled={!!busy} onClick={() => setReviewing({ copy: c })} aria-label={`Review text of ${c.fileName}`}>Review text</button>}
                    {s.proposed > 0 && <button style={{ ...mini, borderColor: C.rel[1], color: C.rel[1] }} disabled={!!busy} onClick={() => setReviewing({ copy: c, pageId: s.firstProposalPageId, tab: "records" })} aria-label={`Review ${s.proposed} proposals in ${c.fileName}`}>{s.proposed} to review</button>}
                    <button style={mini} disabled={!!busy} onClick={() => readCopies([c], s.pages && s.withText === s.pages ? { force: true } : {})} aria-label={`Read ${c.fileName}`}>{s.pages && s.withText === s.pages ? "Read again" : "Read"}</button>
                  </span>
                </div>
                <div style={{ ...small, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  {src ? <span>Source: {src.title}{src.script === "handwritten" ? " (handwritten: waits for HTR)" : ""}</span> : (
                    <>
                      <span>Inbox — which source is this from?</span>
                      <input aria-label={`Source title for ${c.fileName}`} placeholder="Source title" value={titles[c.id] ?? ""} onChange={(e) => setTitles((t) => ({ ...t, [c.id]: e.target.value }))} style={field} />
                      <button style={mini} disabled={!!busy || !(titles[c.id] ?? "").trim()} onClick={() => setSource(c)}>Set source</button>
                    </>
                  )}
                  {c.duplicateResolution === "pending" && (
                    <>
                      <span style={{ color: C.focus }}>Same name as another file, different content.</span>
                      <button style={mini} disabled={!!busy} onClick={() => resolve(c, "keep-both")}>Keep both</button>
                      {c.possibleDuplicateOf.length === 1 && <button style={mini} disabled={!!busy} onClick={() => resolve(c, "replace")}>Replace old</button>}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {runs.length > 0 && (
        <details style={{ marginTop: 8 }} data-testid="runs">
          <summary style={{ ...small, cursor: "pointer" }}>Processing runs ({runs.length} most recent){runs.some((r) => r.failed) ? " — some pages failed" : ""}</summary>
          <ul style={{ listStyle: "none", margin: "4px 0 0", padding: 0, maxHeight: 170, overflowY: "auto" }}>
            {runs.map(({ run: r, items, failed }) => (
              <li key={r.id} style={{ padding: "3px 0", borderBottom: `1px solid ${C.ruleFaint}` }}>
                <div style={mono}>{new Date(r.startedAt).toLocaleString()} · {r.processor}{r.processorVersion ? ` ${r.processorVersion}` : ""} · {r.status} · {items.length} page{items.length === 1 ? "" : "s"}{failed ? `, ${failed} failed` : ""}</div>
                {items.filter((i) => i.status === "failed").map((i) => (
                  <div key={i.id} style={{ ...small, display: "flex", gap: 6, alignItems: "center", color: C.focus }}>
                    <span>page {pageName(i.pageId)}: {i.error}</span>
                    <button style={mini} disabled={!!busy} onClick={() => rerun(i.id)}>Re-run page</button>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </details>
      )}

      {reviewing && <TextReview library={library} copy={reviewing.copy} initialPageId={reviewing.pageId} initialTab={reviewing.tab} loadImage={loadImage} onClose={closeReview} runExtraction={runExtraction} describeExtraction={describeExtraction} runReading={runReading} />}

      {cache.entries > 0 && (
        <div style={{ ...small, marginTop: 6, display: "flex", gap: 8, alignItems: "center" }}>
          <span>Page image cache: {cache.entries} images, {formatBytes(cache.bytes)}</span>
          <button style={mini} disabled={!!busy} onClick={clearCache}>Clear cache</button>
        </div>
      )}
    </div>
  );
}
