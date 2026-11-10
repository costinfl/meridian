import { normalizeText, boxFromPixels } from "../evidence/index.js";
import { assessText, DEFAULT_QUALITY } from "./quality.js";
import { ensurePages, getPageImage, loadCopyBytes, openDocument } from "./documents.js";
import { VERSIONS } from "./versions.js";

/*
 * Ingestion pipeline for one copy. Every step is a ProcessingRun with one item per page:
 *   1. router      decides per page: embedded text is good -> pdf-text; a DOCX -> docx-text; a source flagged
 *                  handwritten -> awaiting HTR (no OCR); otherwise -> OCR
 *   2. pdf-text / docx-text   text layers from the file's own text
 *   3. tesseract   OCR of the rendered page image
 * Text layers go on the page's whole-page region, with the processor's raw output stored. A page that already
 * has text is skipped unless `force` is set, so processing a copy twice adds nothing. A failed page fails only
 * its own item; the run ends `partial`. Cancelling (AbortSignal) stops between pages and ends the run `cancelled`.
 * Automated code: it only records what it read. Nothing here confirms or decides anything.
 */

export const CLASSIFICATIONS = ["embedded-text", "docx-text", "needs-ocr", "handwritten", "already-has-text"];
const TEXT_PROCESSOR = { "embedded-text": "pdf-text", "docx-text": "docx-text", "needs-ocr": "tesseract" };
const isHandwritten = (source) => String(source?.script ?? "").toLowerCase() === "handwritten";
const errText = (e) => String(e?.message ?? e).slice(0, 500);

/**
 * @param {object} a
 * @param {object} a.library       createEvidenceLibrary(storage)
 * @param {object} a.copy          the DigitalCopy
 * @param {object} a.doc           openDocument(...) for that copy
 * @param {object} [a.ocr]         { recognize({ bytes, mimeType, width, height }) -> { text, confidence, words, raw, rawMediaType }, languages, version, model }
 * @param {string[]} [a.pageIds]   only these pages (re-run of one page = a one-page batch)
 * @param {boolean} [a.force]      process pages that already have text
 * @param {string} [a.processor]   skip routing and use this text processor (for re-runs)
 * @param {(p: object) => void} [a.onProgress]   { stage, done, total, pageIndex }
 * @param {AbortSignal} [a.signal]
 */
export async function processCopy({ library, copy, doc, ocr, pageIds, force = false, processor, quality = {}, maxSide = 2000, onProgress, signal }) {
  const source = copy.sourceId ? await library.sources.get(copy.sourceId) : null;
  let pages = await ensurePages({ library, copy, doc });
  if (pageIds) pages = pages.filter((p) => pageIds.includes(p.id));
  const total = pages.length;
  const summary = { copyId: copy.id, pages: [], runIds: [], cancelled: false };
  const cancelled = () => !!signal?.aborted;

  /* ---- 1. router ---- */
  const qualityOptions = { ...DEFAULT_QUALITY, ...quality };
  const router = await library.runs.startRun({ processor: "router", processorVersion: VERSIONS.router, parameters: { copyId: copy.id, quality: qualityOptions, force, forcedProcessor: processor ?? null } });
  summary.runIds.push(router.id);
  const plan = []; // { page, classification, processor, embedded }
  let routerFailed = 0, done = 0;
  for (const page of pages) {
    onProgress?.({ stage: "router", done, total, pageIndex: page.pageIndex });
    if (cancelled()) break;                 // checked after reporting, so a cancel from the callback takes effect at once
    done++;
    try {
      const existing = force ? null : await library.textLayers.current(page.wholePageRegionId);
      let classification, check = null, embedded = null;
      if (existing) classification = "already-has-text";
      else if (processor) { classification = Object.keys(TEXT_PROCESSOR).find((k) => TEXT_PROCESSOR[k] === processor); if (processor !== "tesseract") embedded = await doc.pageText(page.pageIndex); }
      else if (doc.kind === "docx") { classification = "docx-text"; embedded = await doc.pageText(page.pageIndex); }
      else if (isHandwritten(source)) classification = "handwritten";
      else {
        embedded = await doc.pageText(page.pageIndex);
        check = assessText(embedded?.text ?? "", qualityOptions);
        classification = check.ok ? "embedded-text" : "needs-ocr";
      }
      const next = TEXT_PROCESSOR[classification] ?? null;
      const status = classification === "handwritten" ? "awaiting-htr" : classification === "already-has-text" ? "skipped" : "succeeded";
      await library.runs.addItem({ runId: router.id, pageId: page.id, status, result: { classification, processor: next, quality: check } });
      plan.push({ page, classification, processor: next, embedded });
      summary.pages.push({ pageId: page.id, pageIndex: page.pageIndex, classification, processor: next, status: next ? "pending" : status, error: "" });
    } catch (e) {
      routerFailed++;
      await library.runs.addItem({ runId: router.id, pageId: page.id, status: "failed", error: errText(e) });
      summary.pages.push({ pageId: page.id, pageIndex: page.pageIndex, classification: null, processor: null, status: "failed", error: errText(e) });
    }
  }
  await library.runs.finishRun(router.id, cancelled() ? "cancelled" : routerFailed === 0 ? "succeeded" : routerFailed === pages.length ? "failed" : "partial");

  /* ---- 2 + 3. text processors: one run per processor ---- */
  const setPage = (pageId, patch) => Object.assign(summary.pages.find((p) => p.pageId === pageId), patch);
  for (const name of ["pdf-text", "docx-text", "tesseract"]) {
    const batch = plan.filter((p) => p.processor === name);
    if (!batch.length || cancelled()) continue;
    if (name === "tesseract" && !ocr) { for (const b of batch) setPage(b.page.id, { status: "failed", error: "OCR is not available" }); continue; }
    const run = await library.runs.startRun(name === "tesseract"
      ? { processor: name, processorVersion: ocr.version ?? VERSIONS.tesseractJs, modelId: ocr.model ?? VERSIONS.ronTraineddata, parameters: { languages: ocr.languages ?? ["ron"], maxSide }, schemaVersion: "tesseract-words-1" }
      : { processor: name, processorVersion: name === "pdf-text" ? VERSIONS.pdfjs : VERSIONS.mammoth, schemaVersion: `${name}-1` });
    summary.runIds.push(run.id);
    let failed = 0, n = 0;
    for (const { page, embedded } of batch) {
      onProgress?.({ stage: name, done: n, total: batch.length, pageIndex: page.pageIndex });
      if (cancelled()) break;
      n++;
      const item = await library.runs.addItem({ runId: run.id, pageId: page.id, status: "running" });
      try {
        let layer, raw;
        if (name === "tesseract") {
          const image = await getPageImage({ library, page, doc, maxSide });
          if (!image) throw new Error("This page has no image to read");
          const res = await ocr.recognize({ bytes: image.bytes, mimeType: image.mimeType, width: image.width, height: image.height });
          const words = [];
          for (const w of res.words ?? []) {
            try { words.push({ text: w.text, box: boxFromPixels({ x: w.bbox.x0, y: w.bbox.y0, w: w.bbox.x1 - w.bbox.x0, h: w.bbox.y1 - w.bbox.y0 }, image.width, image.height) }); } catch { /* a degenerate box: keep the text, drop the box */ }
          }
          raw = await library.runs.addRawOutput({ data: res.raw ?? JSON.stringify(res), mediaType: res.rawMediaType ?? "application/json", schemaVersion: "tesseract-words-1" });
          const text = String(res.text ?? "").replace(/\s+$/, "");
          layer = { originalText: text, words, confidence: typeof res.confidence === "number" ? Math.min(1, Math.max(0, res.confidence / 100)) : null };
        } else {
          const got = embedded ?? (await doc.pageText(page.pageIndex));
          if (!got) throw new Error("This page has no embedded text");
          raw = await library.runs.addRawOutput({ data: JSON.stringify(got), mediaType: "application/json", schemaVersion: `${name}-1` });
          layer = { originalText: got.text, words: got.words ?? null, confidence: null };
        }
        await library.textLayers.add({ regionId: page.wholePageRegionId, runId: run.id, ...layer, normalizedText: normalizeText(layer.originalText), language: name === "tesseract" ? (ocr.languages ?? ["ron"]).join("+") : "" });
        await library.runs.updateItem(item.id, { status: "succeeded", rawOutputId: raw.id, unitsBilled: 0 });
        setPage(page.id, { status: "succeeded" });
      } catch (e) {
        failed++;
        await library.runs.updateItem(item.id, { status: "failed", error: errText(e) });
        setPage(page.id, { status: "failed", error: errText(e) });
      }
    }
    await library.runs.finishRun(run.id, cancelled() ? "cancelled" : failed === 0 ? "succeeded" : failed === batch.length ? "failed" : "partial");
  }
  if (cancelled()) { summary.cancelled = true; for (const p of summary.pages) if (p.status === "pending") p.status = "cancelled"; }
  onProgress?.({ stage: "done", done: total, total, pageIndex: null });
  return summary;
}

/** Runs with their items, newest first, for the status view. `copyId` limits to runs that touched that copy. */
export async function listRunsWithItems({ library, copyId = null, limit = 30 }) {
  const pageIds = copyId ? new Set((await library.pages.listPages(copyId)).map((p) => p.id)) : null;
  const out = [];
  for (const run of await library.runs.listRuns()) {
    const items = await library.runs.listItems(run.id);
    if (pageIds && !items.some((i) => pageIds.has(i.pageId))) continue;
    out.push({ run, items, failed: items.filter((i) => i.status === "failed").length });
    if (out.length >= limit) break;
  }
  return out;
}

/** What a failed item needs to be re-run as a one-page batch: { copyId, pageId, processor }. */
export async function rerunTargetOf({ library, itemId }) {
  const item = await library.runs.getItem(itemId);
  if (!item) throw new Error(`Run item not found: ${itemId}`);
  const run = await library.runs.getRun(item.runId);
  const page = await library.pages.getPage(item.pageId);
  return { copyId: page.copyId, pageId: page.id, processor: run.processor === "router" ? null : run.processor };
}

/**
 * Read one copy end to end: load its bytes (checking they still match the registered hash), open the document,
 * run the pipeline, close the document. `options` are passed to processCopy (pageIds, processor, force...).
 */
export async function ingestCopy({ library, storage, copyId, folderHandle, engines, ocr, onProgress, signal, ...options }) {
  const copy = await library.copies.get(copyId);
  if (!copy) throw new Error(`Copy not found: ${copyId}`);
  const bytes = await loadCopyBytes({ storage, copy, folderHandle });
  const doc = await openDocument({ fileName: copy.fileName, bytes, engines });
  try {
    return await processCopy({ library, copy, doc, ocr, onProgress, signal, ...options });
  } finally {
    await doc.close().catch(() => {});
  }
}

/** Per copy: how many pages exist and how many have text. { [copyId]: { pages, withText } } */
export async function textStatusOf({ library, copyIds }) {
  const out = {};
  for (const id of copyIds) {
    const pages = await library.pages.listPages(id);
    let withText = 0;
    for (const p of pages) { const whole = await library.pages.wholePageRegion(p.id); if (whole && (await library.textLayers.current(whole.id))) withText++; }
    out[id] = { pages: pages.length, withText };
  }
  return out;
}
