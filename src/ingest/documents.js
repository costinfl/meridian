import { sha256Hex } from "../evidence/index.js";
import { classifyFile } from "./fileTypes.js";
import { readFolderFile } from "./folder.js";

/*
 * A uniform reader over the document types ingestion understands. `engines` supplies the heavy libraries, so
 * this module stays pure and testable (browser engines: engines.browser.js; tests use Node builds or stubs):
 *   engines.openPdf(bytes)            -> a pdf.js document
 *   engines.renderPdfPage(page, scale) -> { bytes, mimeType, width, height }   (browser only)
 *   engines.docxText(bytes)           -> string
 *   engines.imageSize(bytes, mime)    -> { width, height }
 *
 * openDocument(...) returns:
 *   { kind, pageCount, pageInfo(i), pageText(i), pageImage(i, maxSide), close() }
 *   pageInfo  -> { width, height, rotation }   size of the UNROTATED page (PDF points, or pixels for images)
 *   pageText  -> { text, words: [{ text, box }] } with boxes normalised to 0-1 on the unrotated page (I4),
 *                or null when the page has no embedded text
 *   pageImage -> { bytes, mimeType, width, height } of the unrotated page, or null (DOCX has no image)
 */

const clamp01 = (v) => Math.min(1, Math.max(0, v));
export const DOCX_PAGE = { width: 595, height: 842, rotation: 0 }; // a DOCX is one text page; nominal A4 size

/**
 * pdf.js text items -> words with normalised boxes. Items are text runs in PDF user space (origin bottom-left,
 * unrotated page); a run's box is split between its words in proportion to their length.
 * @param {Array} items  from page.getTextContent()
 * @param {number[]} view  page.view = [x0, y0, x1, y1]
 */
export function pdfItemsToWords(items, view) {
  const [vx0, vy0, vx1, vy1] = view;
  const W = vx1 - vx0, H = vy1 - vy0;
  const words = [], lines = [];
  let line = "";
  for (const it of items ?? []) {
    const str = it.str ?? "";
    if (str.trim()) {
      const [a, b, , , e, f] = it.transform;
      const upright = Math.abs(b) < 1e-3 * Math.max(1, Math.abs(a));
      const h = it.height || Math.hypot(it.transform[2], it.transform[3]) || 1;
      const left = e, right = e + (it.width || 0), bottom = f - 0.22 * h, top = f + 0.88 * h; // baseline -> approx glyph box
      const tokens = str.split(/(\s+)/).filter((t) => t.length);
      const total = tokens.reduce((n, t) => n + t.length, 0) || 1;
      let cursor = left;
      for (const tok of tokens) {
        const w = ((right - left) * tok.length) / total;
        if (tok.trim() && upright && right > left) {
          const box = { x0: clamp01((cursor - vx0) / W), y0: clamp01(1 - (top - vy0) / H), x1: clamp01((cursor + w - vx0) / W), y1: clamp01(1 - (bottom - vy0) / H) };
          if (box.x1 > box.x0 && box.y1 > box.y0) words.push({ text: tok, box });
        } else if (tok.trim()) {
          // rotated or zero-width run: keep the text, give it the run's bounding area if valid
          const box = { x0: clamp01((Math.min(left, right) - vx0) / W), y0: clamp01(1 - (top - vy0) / H), x1: clamp01((Math.max(left, right) - vx0) / W), y1: clamp01(1 - (bottom - vy0) / H) };
          if (box.x1 > box.x0 && box.y1 > box.y0) words.push({ text: tok, box });
        }
        cursor += w;
      }
    }
    line += str;
    if (it.hasEOL) { lines.push(line); line = ""; } else if (str && !/\s$/.test(str)) line += " ";
  }
  if (line.trim()) lines.push(line);
  const text = lines.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
  return { text, words };
}

async function openPdf(bytes, engines) {
  const doc = await engines.openPdf(bytes);
  const page = (i) => doc.getPage(i + 1);
  return {
    kind: "pdf",
    pageCount: doc.numPages,
    async pageInfo(i) { const p = await page(i); const [x0, y0, x1, y1] = p.view; return { width: x1 - x0, height: y1 - y0, rotation: ((p.rotate % 360) + 360) % 360 }; },
    async pageText(i) {
      const p = await page(i);
      const tc = await p.getTextContent();
      const out = pdfItemsToWords(tc.items, p.view);
      return out.text ? out : null;
    },
    async pageImage(i, maxSide = 1600) {
      if (!engines.renderPdfPage) return null;
      const p = await page(i); const [x0, y0, x1, y1] = p.view;
      const scale = maxSide / Math.max(x1 - x0, y1 - y0);
      return engines.renderPdfPage(p, scale);
    },
    async close() { await doc.destroy?.(); },
  };
}

async function openDocx(bytes, engines) {
  const text = String(await engines.docxText(bytes)).replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return {
    kind: "docx", pageCount: 1,
    async pageInfo() { return DOCX_PAGE; },
    async pageText() { return { text, words: null }; },
    async pageImage() { return null; },
    async close() {},
  };
}

async function openImage(bytes, mimeType, engines) {
  const size = await engines.imageSize(bytes, mimeType);
  return {
    kind: "image", pageCount: 1,
    async pageInfo() { return { width: size.width, height: size.height, rotation: 0 }; },
    async pageText() { return null; },
    async pageImage() { return { bytes, mimeType, width: size.width, height: size.height }; },
    async close() {},
  };
}

export async function openDocument({ fileName, bytes, engines }) {
  const type = classifyFile(fileName);
  if (!type.supported) throw new Error(type.reason);
  if (type.kind === "pdf") return openPdf(bytes, engines);
  if (type.kind === "docx") return openDocx(bytes, engines);
  return openImage(bytes, type.mimeType, engines);
}

/**
 * The bytes of a copy, from the browser's blob store or the linked folder. Refuses a file whose content no longer
 * matches the registered hash: evidence must never be attached to different bytes than were registered.
 */
export async function loadCopyBytes({ storage, copy, folderHandle }) {
  let file;
  if (copy.storage.mode === "blob") {
    file = await storage.loadBlob(copy.storage.blobKey);
    if (!file) throw new Error(`The stored file for "${copy.fileName}" is missing`);
  } else {
    if (!folderHandle) throw new Error("The documents folder is not linked (or permission was not granted)");
    try { file = await readFolderFile(folderHandle, copy.storage.path); } catch { throw new Error(`"${copy.storage.path}" was not found in the documents folder; scan the folder again`); }
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if ((await sha256Hex(bytes)) !== copy.sha256) throw new Error(`"${copy.fileName}" has changed since it was scanned; scan the folder again`);
  return bytes;
}

/** Create the Page rows (and whole-page regions) of a copy. Idempotent. Returns the pages in order. */
export async function ensurePages({ library, copy, doc }) {
  const pages = [];
  for (let i = 0; i < doc.pageCount; i++) {
    const info = await doc.pageInfo(i);
    const res = await library.pages.addPage({ copyId: copy.id, pageIndex: i, label: i === 0 ? copy.pageLabelHint ?? "" : "", width: info.width, height: info.height, rotation: info.rotation });
    pages.push({ ...res.page, wholePageRegionId: res.wholePageRegion?.id ?? (await library.pages.wholePageRegion(res.page.id))?.id });
  }
  if (copy.pageCount !== doc.pageCount) await library.copies.update(copy.id, { pageCount: doc.pageCount });
  return pages;
}

/** The rendered image of a page, from the cache or rendered now and cached. Null when the page has no image. */
export async function getPageImage({ library, page, doc, maxSide = 1600 }) {
  const variant = `max${maxSide}`;
  const hit = await library.pageCache.get(page.id, variant);
  if (hit) return { ...hit, cached: true };
  const img = await doc.pageImage(page.pageIndex, maxSide);
  if (!img) return null;
  const saved = await library.pageCache.put({ pageId: page.id, variant, bytes: img.bytes, mimeType: img.mimeType, width: img.width, height: img.height });
  return { ...saved, cached: false };
}
