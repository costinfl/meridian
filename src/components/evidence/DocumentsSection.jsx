import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C, btnStyle } from "../../theme.js";
import { formatBytes } from "../../storage/persistence.js";
import {
  isFolderAccessSupported, linkFolder, getLinkedFolder, unlinkFolder, folderPermission, walkFolder,
  scanEntries, importFiles, assignSource, ingestCopy, listRunsWithItems, rerunTargetOf, textStatusOf,
} from "../../ingest/index.js";

// Documents (Phase 5): link a folder or add files, scan them into the library, read their text (embedded text
// or OCR), and see every processing run with its failures. Heavy libraries load only when "Read" is used.

const small = { font: "400 11.5px Archivo, sans-serif", color: C.inkSoft, lineHeight: 1.5 };
const mono = { font: "400 10.5px 'IBM Plex Mono', monospace", color: C.inkSoft };
const mini = { ...btnStyle(false), padding: "2px 8px", fontSize: 11 };
const field = { font: "500 11.5px Archivo, sans-serif", color: C.ink, background: "#fff", border: `1px solid ${C.rule}`, borderRadius: 3, padding: "2px 6px", width: 150 };

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
export default function DocumentsSection({ storage, library, services = defaultServices, picker }) {
  const [folder, setFolder] = useState(null);          // { handle, name } or null
  const [copies, setCopies] = useState([]);
  const [sources, setSources] = useState({});
  const [status, setStatus] = useState({});            // copyId -> { pages, withText }
  const [runs, setRuns] = useState([]);
  const [cache, setCache] = useState({ entries: 0, bytes: 0 });
  const [busy, setBusy] = useState(null);              // { label, progress }
  const [message, setMessage] = useState("");
  const [titles, setTitles] = useState({});            // copyId -> source title being typed
  const abortRef = useRef(null);
  const svcRef = useRef(null);
  const fileRef = useRef(null);
  const supported = picker ? true : isFolderAccessSupported();

  const refresh = useCallback(async () => {
    const all = (await library.copies.listCurrent()).sort((a, b) => a.fileName.localeCompare(b.fileName));
    const src = Object.fromEntries((await library.sources.list()).map((s) => [s.id, s]));
    setCopies(all); setSources(src);
    setStatus(await textStatusOf({ library, copyIds: all.map((c) => c.id) }));
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

      {cache.entries > 0 && (
        <div style={{ ...small, marginTop: 6, display: "flex", gap: 8, alignItems: "center" }}>
          <span>Page image cache: {cache.entries} images, {formatBytes(cache.bytes)}</span>
          <button style={mini} disabled={!!busy} onClick={clearCache}>Clear cache</button>
        </div>
      )}
    </div>
  );
}
