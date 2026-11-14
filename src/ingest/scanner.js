import { sha256Hex, searchKey } from "../evidence/index.js";
import { classifyFile, isSidecar, SIDECAR_SUFFIX } from "./fileTypes.js";
import { parseSidecar } from "./sidecar.js";

/*
 * Scanner: registers the documents of a folder (or a set of picked files) as DigitalCopies.
 *  - identity is the content hash: re-scanning adds nothing, and a moved or renamed file is recognised and
 *    its location updated;
 *  - a file with no sidecar goes to the Inbox (a copy with no source) until the researcher links it;
 *  - a sidecar ("<file>.meta.json") links the copy to a LibrarySource, created on first use;
 *  - a same-name file with different content is flagged for a keep-both / replace decision (never auto-resolved).
 * Nothing is deleted: files that disappeared are only reported.
 */

const safeName = (s) => String(s || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
const SOURCE_KINDS = ["parish-register", "civil-register", "census", "newspaper-title", "newspaper-issue", "book", "archival-document", "image", "web", "other"];

async function sourceFromSidecar(library, meta, cache) {
  if (!meta?.sourceTitle) return null;
  const key = `${searchKey(meta.sourceTitle)}|${searchKey(meta.repository ?? "")}`;
  if (cache.has(key)) return cache.get(key);
  let repositoryId = null;
  if (meta.repository) {
    const repo = (await library.repositories.findByName(meta.repository)) ?? (await library.repositories.create({ name: meta.repository, kind: "archive" }));
    repositoryId = repo.id;
  }
  const existing = (await library.sources.list()).find((s) => searchKey(s.title) === searchKey(meta.sourceTitle) && (s.repositoryId ?? null) === repositoryId);
  const source = existing ?? (await library.sources.create({
    title: meta.sourceTitle, kind: SOURCE_KINDS.includes(meta.kind) ? meta.kind : "other", repositoryId,
    dateText: meta.date ?? "", script: meta.handwritten ? "handwritten" : "",
  }));
  cache.set(key, source);
  return source;
}

/**
 * @param {object} args
 * @param {Array<{path: string, name: string, getFile: () => Promise<Blob>}>|AsyncIterable} args.entries  e.g. walkFolder(handle)
 * @param {(p: {done: number, total: number, path: string}) => void} [args.onProgress]
 * @param {AbortSignal} [args.signal]
 */
export async function scanEntries({ library, entries, onProgress, signal }) {
  const all = [];
  for await (const e of entries) all.push(e);
  const sidecars = new Map(all.filter((e) => isSidecar(e.name)).map((e) => [e.path, e]));
  const files = all.filter((e) => !isSidecar(e.name));
  const scanPaths = new Set(files.map((e) => e.path));
  const report = { scanned: 0, added: [], known: 0, moved: [], sameContentTwice: [], flagged: [], linked: [], inbox: [], skipped: [], missing: [], warnings: [], cancelled: false };
  const sourceCache = new Map();
  const seenCopyIds = new Set();

  let done = 0;
  for (const entry of files) {
    if (signal?.aborted) { report.cancelled = true; break; }
    onProgress?.({ done, total: files.length, path: entry.path });
    done++;
    const type = classifyFile(entry.name);
    if (!type.supported) { report.skipped.push({ path: entry.path, reason: type.reason }); continue; }
    report.scanned++;

    const file = await entry.getFile();
    const sha256 = await sha256Hex(file);
    let meta = null;
    const side = sidecars.get(entry.path + SIDECAR_SUFFIX);
    if (side) {
      const parsed = parseSidecar(await (await side.getFile()).text());
      if (parsed.error) report.warnings.push(`${side.path}: ${parsed.error}`);
      else { meta = parsed.meta; for (const w of parsed.warnings) report.warnings.push(`${side.path}: ${w}`); }
    }
    const source = await sourceFromSidecar(library, meta, sourceCache);

    let copy = await library.copies.findBySha256(sha256);
    if (copy) {
      if (seenCopyIds.has(copy.id)) { report.sameContentTwice.push({ path: entry.path, sameAs: copy.storage.path ?? copy.fileName }); continue; }
      seenCopyIds.add(copy.id);
      if (copy.storage.mode === "folder" && copy.storage.path !== entry.path) {
        if (scanPaths.has(copy.storage.path)) { report.sameContentTwice.push({ path: entry.path, sameAs: copy.storage.path }); }
        else { const from = copy.storage.path; copy = await library.copies.relocate(copy.id, { mode: "folder", path: entry.path }); copy = await library.copies.update(copy.id, { fileName: entry.name }); report.moved.push({ from, to: entry.path, copyId: copy.id }); }
      } else report.known++;
    } else {
      const res = await library.copies.register({
        sha256, fileName: entry.name, mimeType: type.mimeType, storage: { mode: "folder", path: entry.path },
        sourceId: source?.id ?? null, accessUrl: meta?.accessUrl ?? "", pageLabelHint: meta?.pageLabel ?? "",
      });
      copy = res.copy; seenCopyIds.add(copy.id);
      report.added.push({ path: entry.path, copyId: copy.id });
      if (res.duplicate?.kind === "possible-version") report.flagged.push({ path: entry.path, copyId: copy.id, of: res.duplicate.of });
    }
    // a sidecar added later links a copy that was waiting in the inbox
    if (source && !copy.sourceId) { copy = await library.copies.update(copy.id, { sourceId: source.id, accessUrl: meta.accessUrl ?? copy.accessUrl, pageLabelHint: meta.pageLabel ?? copy.pageLabelHint }); }
    if (source && copy.sourceId === source.id) report.linked.push({ path: entry.path, copyId: copy.id, sourceId: source.id });
    if (!copy.sourceId) report.inbox.push({ path: entry.path, copyId: copy.id });
  }

  if (!report.cancelled) {
    for (const c of await library.copies.listCurrent()) {
      if (c.storage.mode === "folder" && !scanPaths.has(c.storage.path)) report.missing.push({ path: c.storage.path, copyId: c.id });
    }
  }
  onProgress?.({ done, total: files.length, path: "" });
  return report;
}

/**
 * Fallback without folder access (file picker or drag-and-drop): the files are stored in the browser as blobs.
 * @param {{ files: Array<File> }} args
 */
export async function importFiles({ library, storage, files, onProgress, signal }) {
  const report = { scanned: 0, added: [], known: 0, flagged: [], inbox: [], skipped: [], cancelled: false };
  let done = 0;
  for (const file of files) {
    if (signal?.aborted) { report.cancelled = true; break; }
    onProgress?.({ done, total: files.length, path: file.name });
    done++;
    if (isSidecar(file.name)) continue;
    const type = classifyFile(file.name);
    if (!type.supported) { report.skipped.push({ path: file.name, reason: type.reason }); continue; }
    report.scanned++;
    const sha256 = await sha256Hex(file);
    const existing = await library.copies.findBySha256(sha256);
    if (existing) { report.known++; continue; }
    const blobKey = `doc_${sha256.slice(0, 16)}_${safeName(file.name)}`;
    await storage.saveBlob(blobKey, file);
    const res = await library.copies.register({ sha256, fileName: file.name, mimeType: type.mimeType, storage: { mode: "blob", blobKey } });
    report.added.push({ path: file.name, copyId: res.copy.id });
    report.inbox.push({ path: file.name, copyId: res.copy.id });
    if (res.duplicate?.kind === "possible-version") report.flagged.push({ path: file.name, copyId: res.copy.id, of: res.duplicate.of });
  }
  onProgress?.({ done, total: files.length, path: "" });
  return report;
}

/** USER ACTION: take a copy out of the Inbox by naming its source (found by title, or created). */
export async function assignSource({ library, copyId, title }) {
  const t = String(title ?? "").trim();
  if (!t) throw new Error("A source title is required");
  const source = (await library.sources.list()).find((s) => searchKey(s.title) === searchKey(t)) ?? (await library.sources.create({ title: t, kind: "other" }));
  return { source, copy: await library.copies.update(copyId, { sourceId: source.id }) };
}
