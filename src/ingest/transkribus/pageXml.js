import { normalizedBox } from "../../evidence/index.js";

// PAGE XML reader (P7b.T1): the format Transkribus (and other HTR tools) export. Reads the page size, the text
// lines with their positions and the metadata, in reading order. Namespace-agnostic: PAGE 2010/2013/2019 schemas
// and any prefix. Pure: no library access.
//
// Result: { imageFilename, width, height, metadata, lines: [{ text, box, points, regionId, lineId }], text }
//   - `box` is the line's bounding box, 0-1 on the image (I4), clamped to the page;
//   - `text` is the page text: lines joined with "\n", a blank line between regions.

export class PageXmlError extends Error {
  constructor(message) { super(message); this.name = "PageXmlError"; }
}

const elems = (node, name) => [...node.getElementsByTagNameNS("*", name)];
const childElems = (node, name) => [...node.children].filter((c) => c.localName === name);
const firstChild = (node, name) => childElems(node, name)[0] ?? null;

/** "x1,y1 x2,y2 ..." -> [[x, y], ...] (non-numbers dropped). */
export function parsePoints(s) {
  return String(s ?? "").trim().split(/\s+/).map((p) => p.split(",").map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite));
}

/** Transkribus keeps the reading order of a line or region in its `custom` attribute: "readingOrder {index:3;}". */
export function customIndex(custom) {
  const m = /readingOrder\s*\{[^}]*index\s*:\s*(\d+)/.exec(String(custom ?? ""));
  return m ? Number(m[1]) : null;
}

/** The text of a TextLine (or TextRegion): its own TextEquiv/Unicode, or else its words joined. */
function textOf(node) {
  const equivs = childElems(node, "TextEquiv");
  // several TextEquiv: prefer index="0" or the first (PAGE allows alternatives)
  const best = equivs.find((e) => e.getAttribute("index") === "0") ?? equivs[0];
  const unicode = best ? firstChild(best, "Unicode") : null;
  if (unicode) return unicode.textContent ?? "";
  const words = childElems(node, "Word").map((w) => textOf(w)).filter(Boolean);
  return words.join(" ");
}

function boxOf(points, width, height) {
  if (!points.length || !(width > 0) || !(height > 0)) return null;
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const r = (v) => Math.round(v * 1e6) / 1e6;
  const box = { x0: r(clamp(Math.min(...xs) / width)), y0: r(clamp(Math.min(...ys) / height)), x1: r(clamp(Math.max(...xs) / width)), y1: r(clamp(Math.max(...ys) / height)) };
  if (!(box.x1 > box.x0 && box.y1 > box.y0)) return null;
  try { return normalizedBox(box); } catch { return null; }
}

function metadataOf(doc) {
  const md = elems(doc, "Metadata")[0];
  if (!md) return {};
  const text = (name) => (firstChild(md, name)?.textContent ?? "").trim();
  const out = { creator: text("Creator"), created: text("Created"), lastChange: text("LastChange") };
  const tk = firstChild(md, "TranskribusMetadata");
  if (tk) out.transkribus = Object.fromEntries([...tk.attributes].map((a) => [a.name, a.value]));
  const items = childElems(md, "MetadataItem").map((i) => ({
    type: i.getAttribute("type") ?? "", name: i.getAttribute("name") ?? "", value: i.getAttribute("value") ?? "",
    labels: elems(i, "Label").map((l) => ({ type: l.getAttribute("type") ?? "", value: l.getAttribute("value") ?? "" })),
  }));
  if (items.length) out.items = items;
  return out;
}

/** The recognition model named in the metadata, if any (Transkribus writes it in different places over versions). */
export function modelOf(metadata) {
  for (const i of metadata?.items ?? []) {
    const hay = `${i.name} ${i.value}`.toLowerCase();
    const label = i.labels.find((l) => /model/i.test(l.type) && l.value);
    if (label) return label.value;
    if (/htr|recogni|pylaia|text.?titan|model/.test(hay) && i.value) return i.value;
  }
  const c = metadata?.creator ?? "";
  return c || "";
}

/** Parse one PAGE XML document. Throws PageXmlError for text that is not a PAGE document. */
export function parsePageXml(xmlText, { DOMParserImpl = globalThis.DOMParser } = {}) {
  if (!DOMParserImpl) throw new PageXmlError("This browser cannot read XML");
  const doc = new DOMParserImpl().parseFromString(String(xmlText ?? ""), "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new PageXmlError("The file is not well-formed XML");
  const page = elems(doc, "Page")[0];
  if (!page || doc.documentElement.localName !== "PcGts") throw new PageXmlError("The file is not a PAGE XML document (no PcGts/Page)");
  const width = Number(page.getAttribute("imageWidth")), height = Number(page.getAttribute("imageHeight"));
  if (!(width > 0 && height > 0)) throw new PageXmlError("The page has no image size (imageWidth/imageHeight)");

  // reading order of regions: ReadingOrder/OrderedGroup/RegionRefIndexed, else Transkribus `custom`, else document order
  const roIndex = new Map();
  for (const ref of elems(doc, "RegionRefIndexed")) roIndex.set(ref.getAttribute("regionRef"), Number(ref.getAttribute("index")));
  const regions = elems(page, "TextRegion").map((r, docOrder) => ({
    node: r, id: r.getAttribute("id") ?? "", docOrder,
    order: roIndex.get(r.getAttribute("id")) ?? customIndex(r.getAttribute("custom")) ?? 1e9 + docOrder,
  })).sort((a, b) => a.order - b.order || a.docOrder - b.docOrder);

  const lines = [], blocks = [];
  for (const reg of regions) {
    const regionLines = childElems(reg.node, "TextLine").map((l, i) => ({ l, i, order: customIndex(l.getAttribute("custom")) ?? 1e9 + i }))
      .sort((a, b) => a.order - b.order || a.i - b.i);
    const texts = [];
    for (const { l } of regionLines) {
      const text = textOf(l).replace(/\s+$/u, "");
      const coords = firstChild(l, "Coords");
      const points = parsePoints(coords?.getAttribute("points") ?? "");
      lines.push({ text, box: boxOf(points, width, height), points, regionId: reg.id, lineId: l.getAttribute("id") ?? "" });
      texts.push(text);
    }
    if (!regionLines.length) {
      const t = textOf(reg.node).trim();        // a region with text but no lines
      if (t) texts.push(t);
    }
    if (texts.some((t) => t.trim())) blocks.push(texts.join("\n"));
  }
  return {
    imageFilename: page.getAttribute("imageFilename") ?? "",
    width, height, metadata: metadataOf(doc), lines, text: blocks.join("\n\n"),
  };
}
