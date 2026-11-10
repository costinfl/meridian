// @vitest-environment node
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { freshStorage } from "./evidenceHelpers.js";
import { fakeDirectory, memoryDeviceStorage, fixtureBytes } from "./ingestHelpers.js";
import { nodeEngines } from "./nodeEngines.js";
import { createEvidenceLibrary, normalizedBox, sha256Hex } from "../evidence/index.js";
import { openDocument, pdfItemsToWords, loadCopyBytes, ensurePages, getPageImage, DOCX_PAGE } from "../ingest/documents.js";
import { scanEntries } from "../ingest/scanner.js";
import { walkFolder } from "../ingest/folder.js";

let engines, storage, library;
beforeAll(async () => { engines = await nodeEngines(); });
beforeEach(() => { storage = memoryDeviceStorage(freshStorage()); library = createEvidenceLibrary(storage); });
const open = (name) => openDocument({ fileName: name, bytes: fixtureBytes(name), engines });

describe("pdfItemsToWords", () => {
  const view = [0, 0, 600, 800];
  it("turns a text run into words with normalised boxes on the unrotated page, top-left origin", () => {
    const { text, words } = pdfItemsToWords([{ str: "Ștefan Hariton", transform: [10, 0, 0, 10, 60, 700], width: 140, height: 10, hasEOL: true }], view);
    expect(text).toBe("Ștefan Hariton");
    expect(words.map((w) => w.text)).toEqual(["Ștefan", "Hariton"]);
    for (const w of words) expect(() => normalizedBox(w.box)).not.toThrow();
    expect(words[0].box.x0).toBeCloseTo(0.1, 5);                    // 60 / 600
    expect(words[1].box.x1).toBeCloseTo(200 / 600, 5);              // 60 + 140
    expect(words[0].box.x1).toBeLessThan(words[1].box.x0);          // in reading order, not overlapping
    expect(words[0].box.y0).toBeCloseTo(1 - (700 + 8.8) / 800, 5);  // near the top: PDF y grows upwards
    expect(words[0].box.y1).toBeGreaterThan(words[0].box.y0);
  });
  it("joins runs into lines, respects a view that does not start at 0, clamps boxes and drops empty runs", () => {
    const { text, words } = pdfItemsToWords([
      { str: "Naș:", transform: [10, 0, 0, 10, 110, 150], width: 40, height: 10 },
      { str: "Dumitru", transform: [10, 0, 0, 10, 160, 150], width: 70, height: 10, hasEOL: true },
      { str: "   ", transform: [10, 0, 0, 10, 0, 0], width: 30, height: 10 },
      { str: "margine", transform: [10, 0, 0, 10, 680, 120], width: 90, height: 10, hasEOL: true },   // runs off the page
    ], [100, 100, 700, 900]);
    expect(text).toBe("Naș: Dumitru\nmargine");
    expect(words[0].box.x0).toBeCloseTo(10 / 600, 5);
    const last = words.at(-1).box;
    expect(last.x1).toBe(1);
    for (const w of words) expect(() => normalizedBox(w.box)).not.toThrow();
    expect(pdfItemsToWords([], view)).toEqual({ text: "", words: [] });
  });
});

describe("openDocument on real files (P5.T3)", () => {
  it("text PDF: page count, size, rotation, embedded text with Romanian diacritics and word boxes", async () => {
    const doc = await open("text.pdf");
    expect(doc).toMatchObject({ kind: "pdf", pageCount: 2 });
    expect(await doc.pageInfo(0)).toEqual({ width: 595, height: 842, rotation: 0 });
    const t = await doc.pageText(0);
    expect(t.text).toContain("Ștefan Hariton, născut la 12 Martie 1850");
    expect(t.text.split("\n")).toHaveLength(3);
    expect(t.words.length).toBeGreaterThan(20);
    for (const w of t.words) expect(() => normalizedBox(w.box)).not.toThrow();
    const stefan = t.words.find((w) => w.text === "Ștefan");
    expect(stefan.box.x0).toBeCloseTo(60 / 595, 2);                 // drawn at x = 60 pt
    expect(stefan.box.y0).toBeGreaterThan(0.1);                     // second line, near the top
    expect(stefan.box.y1).toBeLessThan(0.16);
    expect((await doc.pageText(1)).text).toContain("Elena Băltăceanu");
    expect(await doc.pageImage(0)).toBeNull();                      // no renderer in Node
    await doc.close();
  });
  it("scanned PDF (image only): a page with no embedded text", async () => {
    const doc = await open("scanned.pdf");
    expect(doc.pageCount).toBe(1);
    expect(await doc.pageInfo(0)).toEqual({ width: 500, height: 150, rotation: 0 });
    expect(await doc.pageText(0)).toBeNull();
    await doc.close();
  });
  it("DOCX: one text page without an image", async () => {
    const doc = await open("note.docx");
    expect(doc).toMatchObject({ kind: "docx", pageCount: 1 });
    expect(await doc.pageInfo(0)).toEqual(DOCX_PAGE);
    const t = await doc.pageText(0);
    expect(t.text).toBe("Notă de cercetare\n\nȘtefan Hariton s-a născut la Săhăteni în 1850.\n\nSursa: registrul parohial, f. 23v.");
    expect(t.words).toBeNull();
    expect(await doc.pageImage(0)).toBeNull();
  });
  it("image: one page whose image is the file itself; legacy .doc is refused with advice", async () => {
    const doc = await open("scan.png");
    expect(doc).toMatchObject({ kind: "image", pageCount: 1 });
    expect(await doc.pageInfo(0)).toEqual({ width: 1000, height: 300, rotation: 0 });
    expect(await doc.pageText(0)).toBeNull();
    const img = await doc.pageImage(0);
    expect(img).toMatchObject({ mimeType: "image/png", width: 1000, height: 300 });
    expect(img.bytes.byteLength).toBe(fixtureBytes("scan.png").byteLength);
    await expect(openDocument({ fileName: "vechi.doc", bytes: new Uint8Array(1), engines })).rejects.toThrow(/convert to DOCX or PDF/);
  });
});

describe("pages, copy bytes and the disposable page cache", () => {
  const scanned = async (tree) => {
    const dir = fakeDirectory(tree);
    const r = await scanEntries({ library, entries: walkFolder(dir) });
    return { dir, copies: await Promise.all(r.added.map((a) => library.copies.get(a.copyId))) };
  };

  it("ensurePages creates page rows with whole-page regions once, applies the sidecar page label, records the page count", async () => {
    const { copies } = await scanned({ "text.pdf": fixtureBytes("text.pdf"), "text.pdf.meta.json": '{"sourceTitle":"Botezuri","pageLabel":"f. 23v"}' });
    const copy = copies[0];
    const doc = await open("text.pdf");
    const pages = await ensurePages({ library, copy, doc });
    expect(pages.map((p) => [p.pageIndex, p.label, p.width, p.height])).toEqual([[0, "f. 23v", 595, 842], [1, "", 595, 842]]);
    expect(pages.every((p) => p.wholePageRegionId)).toBe(true);
    expect((await library.copies.get(copy.id)).pageCount).toBe(2);
    const again = await ensurePages({ library, copy: await library.copies.get(copy.id), doc });
    expect(again.map((p) => p.id)).toEqual(pages.map((p) => p.id));
    expect(await storage.dbCount("evPages")).toBe(2);
    expect(await storage.dbCount("evRegions")).toBe(2);
  });

  it("loadCopyBytes reads from the folder or the blob store and refuses content that changed since the scan", async () => {
    const { dir, copies } = await scanned({ "Registre": { "scan.png": fixtureBytes("scan.png") } });
    const bytes = await loadCopyBytes({ storage, copy: copies[0], folderHandle: dir });
    expect(await sha256Hex(bytes)).toBe(copies[0].sha256);
    await expect(loadCopyBytes({ storage, copy: copies[0], folderHandle: null })).rejects.toThrow(/not linked/);
    await expect(loadCopyBytes({ storage, copy: copies[0], folderHandle: fakeDirectory({}) })).rejects.toThrow(/not found/);
    const changed = fakeDirectory({ "Registre": { "scan.png": fixtureBytes("text.pdf") } });
    await expect(loadCopyBytes({ storage, copy: copies[0], folderHandle: changed })).rejects.toThrow(/has changed since it was scanned/);
    // blob mode
    const blobCopy = (await library.copies.register({ sha256: await sha256Hex(fixtureBytes("note.docx")), fileName: "note.docx", storage: { mode: "blob", blobKey: "k1" } })).copy;
    await expect(loadCopyBytes({ storage, copy: blobCopy })).rejects.toThrow(/missing/);
    const b = fixtureBytes("note.docx");
    await storage.saveBlob("k1", { arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) });
    expect((await loadCopyBytes({ storage, copy: blobCopy })).byteLength).toBe(b.byteLength);
  });

  it("page images are rendered on demand, cached, and regenerated after the cache is cleared", async () => {
    const { copies } = await scanned({ "scan.png": fixtureBytes("scan.png") });
    const doc = await open("scan.png");
    let renders = 0;
    const counting = { ...doc, pageImage: async (...a) => { renders++; return doc.pageImage(...a); } };
    const [page] = await ensurePages({ library, copy: copies[0], doc });
    const first = await getPageImage({ library, page, doc: counting });
    expect(first).toMatchObject({ cached: false, mimeType: "image/png", width: 1000, height: 300 });
    const second = await getPageImage({ library, page, doc: counting });
    expect(second.cached).toBe(true);
    expect(renders).toBe(1);
    expect(Array.from(second.bytes.slice(0, 8))).toEqual(Array.from(fixtureBytes("scan.png").slice(0, 8)));
    expect(await library.pageCache.stats()).toEqual({ entries: 1, bytes: fixtureBytes("scan.png").byteLength });
    expect(await library.pageCache.clear()).toBe(1);
    expect(await library.pageCache.stats()).toEqual({ entries: 0, bytes: 0 });
    const third = await getPageImage({ library, page, doc: counting });       // regenerated
    expect(third.cached).toBe(false);
    expect(renders).toBe(2);
    expect(await library.pageCache.clear(page.id)).toBe(1);
    // a page with no image (DOCX) is simply null and caches nothing
    const docx = await open("note.docx");
    expect(await getPageImage({ library, page, doc: docx })).toBeNull();
    expect((await library.pageCache.stats()).entries).toBe(0);
  });
});
