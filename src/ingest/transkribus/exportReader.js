import JSZip from "jszip";
import { parsePageXml } from "./pageXml.js";

// Reading a Transkribus export and matching its pages to registered pages (P7b.T2).
// An export is a ZIP (…/page/*.xml, …/mets.xml, maybe images) or loose PAGE XML files. Images are not imported:
// the pages already exist in Meridian. Matching never guesses: a page matches by its image file name, or by page
// order inside a document the researcher picks; everything else is reported as unmatched with the reason.

const ASPECT_TOLERANCE = 0.03;
const IMAGE_EXT = /\.(png|jpe?g|tiff?|webp|gif|bmp|jp2)$/i;
const naturalCompare = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
const baseName = (p) => String(p ?? "").split(/[\\/]/).pop();

/** Keys a file name can be matched by: the name without extension, and without a Transkribus "0001_" prefix. */
export function nameKeys(fileName) {
  const base = baseName(fileName).replace(/\.[^.]+$/, "").toLowerCase().normalize("NFC");
  const keys = new Set([base]);
  const stripped = base.replace(/^\d{1,5}[_-]/, "");
  if (stripped) keys.add(stripped);
  return [...keys];
}

/** Page order from a METS file: the PAGE XML files of the PAGEXML file group, in file-section order. */
export function metsOrder(metsText, { DOMParserImpl = globalThis.DOMParser } = {}) {
  const doc = new DOMParserImpl().parseFromString(String(metsText ?? ""), "application/xml");
  if (doc.getElementsByTagName("parsererror").length) return [];
  const out = [];
  for (const grp of doc.getElementsByTagNameNS("*", "fileGrp")) {
    const id = `${grp.getAttribute("ID") ?? ""} ${grp.getAttribute("USE") ?? ""}`;
    if (!/page/i.test(id)) continue;
    for (const loc of grp.getElementsByTagNameNS("*", "FLocat")) {
      const href = loc.getAttributeNS("http://www.w3.org/1999/xlink", "href") ?? loc.getAttribute("xlink:href") ?? loc.getAttribute("href");
      if (href && /\.xml$/i.test(href) && !out.includes(baseName(href))) out.push(baseName(href));   // file groups can nest
    }
  }
  return out;
}

/**
 * Read an export from files (File/Blob objects with a `name`). Returns { pages, errors } where pages are
 * [{ source, xml, parsed }] in page order (METS order if present, else natural file-name order).
 */
export async function readExport(files) {
  const entries = [], errors = [];
  let mets = null;
  for (const f of files) {
    const name = f.name ?? "file";
    if (/\.zip$/i.test(name)) {
      let zip;
      try { zip = await JSZip.loadAsync(await f.arrayBuffer()); }
      catch { errors.push({ source: name, error: "not a readable ZIP file" }); continue; }
      for (const [path, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;
        if (/(^|\/)mets\.xml$/i.test(path)) { mets = await entry.async("string"); continue; }
        if (/(^|\/)page\/[^/]+\.xml$/i.test(path) || (/\.xml$/i.test(path) && !/(^|\/)(doc|metadata)\.xml$/i.test(path))) {
          entries.push({ source: `${name}: ${path}`, file: baseName(path), xml: await entry.async("string") });
        }
      }
    } else if (/\.xml$/i.test(name)) {
      const xml = await f.text();
      if (/<(\w+:)?mets[\s>]/i.test(xml.slice(0, 2000)) && /mets\.xml$/i.test(name)) { mets = xml; continue; }
      entries.push({ source: name, file: baseName(name), xml });
    } else if (!IMAGE_EXT.test(name)) {
      errors.push({ source: name, error: "not a ZIP or XML file" });
    }
  }
  const order = mets ? metsOrder(mets) : [];
  const rank = (e) => { const i = order.indexOf(e.file); return i < 0 ? Infinity : i; };
  entries.sort((a, b) => rank(a) - rank(b) || naturalCompare(a.file, b.file));
  const pages = [];
  for (const e of entries) {
    try { pages.push({ source: e.source, file: e.file, xml: e.xml, parsed: parsePageXml(e.xml) }); }
    catch (err) {
      // a ZIP can hold other XML files (Transkribus doc.xml, metadata): only report files that look like PAGE
      if (/PcGts/.test(e.xml.slice(0, 4000)) || !/\.zip:/.test(e.source)) errors.push({ source: e.source, error: err.message });
    }
  }
  return { pages, errors, usedMets: order.length > 0 };
}

/** Does the export image have the page's shape? { ok, rotated } (rotated: it matches the page turned by 90°). */
export function aspectCheck(exportPage, page) {
  const a = exportPage.width / exportPage.height, b = page.width / page.height;
  const near = (x, y) => Math.abs(x - y) / y <= ASPECT_TOLERANCE;
  return { ok: near(a, b), rotated: !near(a, b) && near(a, 1 / b) };
}

/**
 * Match exported pages to registered pages.
 *   - by file name: the export's imageFilename against single-image documents (exactly one candidate);
 *   - by order: pages not matched by name go, in order, onto the pages of `copyId` (a PDF or multi-page document).
 * Returns { matched: [{ exportPage, copy, page, via, aspect }], unmatched: [{ exportPage, reason }], warnings }.
 */
export async function matchPages({ library, exportPages, copyId = null }) {
  const copies = await library.copies.listCurrent();
  const byKey = new Map();
  for (const c of copies) {
    if (!IMAGE_EXT.test(c.fileName)) continue;
    for (const k of nameKeys(c.fileName)) { if (!byKey.has(k)) byKey.set(k, new Set()); byKey.get(k).add(c); }
  }
  const matched = [], unmatched = [], warnings = [], rest = [];
  const firstPageOf = async (copy) => (await library.pages.listPages(copy.id))[0] ?? null;
  const used = new Set();
  for (const ep of exportPages) {
    if (copyId) { rest.push(ep); continue; }        // a chosen document: every page is placed by order
    const p = ep.parsed;
    const candidates = new Set();
    for (const k of nameKeys(p.imageFilename || ep.file)) for (const c of byKey.get(k) ?? []) candidates.add(c);
    if (candidates.size > 1) { unmatched.push({ exportPage: ep, reason: `${candidates.size} documents have that file name; pick the document to match by page order` }); continue; }
    if (candidates.size === 1) {
      const copy = [...candidates][0];
      const page = await firstPageOf(copy);
      if (!page) { unmatched.push({ exportPage: ep, reason: `"${copy.fileName}" has not been read yet; click Read first` }); continue; }
      if (used.has(page.id)) { unmatched.push({ exportPage: ep, reason: `another exported page already matches "${copy.fileName}"` }); continue; }
      used.add(page.id);
      matched.push({ exportPage: ep, copy, page, via: "file name", aspect: aspectCheck(p, page) });
      continue;
    }
    rest.push(ep);
  }
  if (rest.length && copyId) {
    const copy = await library.copies.get(copyId);
    const pages = copy ? await library.pages.listPages(copyId) : [];
    if (!copy) warnings.push("The chosen document no longer exists.");
    else if (!pages.length) warnings.push(`"${copy.fileName}" has not been read yet; click Read first.`);
    else {
      if (pages.length !== rest.length) warnings.push(`The export has ${rest.length} pages to place and "${copy.fileName}" has ${pages.length}; pages are matched in order as far as both go.`);
      rest.forEach((ep, i) => {
        const page = pages[i];
        if (!page) unmatched.push({ exportPage: ep, reason: `"${copy.fileName}" has no page ${i + 1}` });
        else matched.push({ exportPage: ep, copy, page, via: "page order", aspect: aspectCheck(ep.parsed, page) });
      });
      return { matched, unmatched, warnings };
    }
  }
  for (const ep of rest) unmatched.push({ exportPage: ep, reason: copyId ? "not placed" : `no document named "${ep.parsed.imageFilename || ep.file}"; pick a document to match by page order` });
  return { matched, unmatched, warnings };
}
