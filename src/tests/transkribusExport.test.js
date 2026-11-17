import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { freshStorage } from "./evidenceHelpers.js";
import { createEvidenceLibrary } from "../evidence/index.js";
import { readExport, matchPages, nameKeys, metsOrder, aspectCheck } from "../ingest/transkribus/exportReader.js";

const fx = (n) => fs.readFileSync(path.join(__dirname, "fixtures", "transkribus", n), "utf8");
const file = (name, data) => {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return { name, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), text: async () => new TextDecoder().decode(bytes) };
};
/** A PAGE XML for page n of a register scanned as one PDF (image names as Transkribus gives them). */
const pageXml = (img, w, h, text) => `<?xml version="1.0"?><PcGts xmlns="http://schema.primaresearch.org/PAGE/gts/pagecontent/2013-07-15"><Metadata><Creator>Transkribus</Creator><Created>2026-11-12T10:00:00</Created><LastChange>2026-11-12T10:00:00</LastChange></Metadata><Page imageFilename="${img}" imageWidth="${w}" imageHeight="${h}"><TextRegion id="r"><TextLine id="l"><Coords points="10,10 ${w - 10},10 ${w - 10},60 10,60"/><TextEquiv><Unicode>${text}</Unicode></TextEquiv></TextLine></TextRegion></Page></PcGts>`;
const METS = (names) => `<?xml version="1.0"?><mets:mets xmlns:mets="http://www.loc.gov/METS/" xmlns:xlink="http://www.w3.org/1999/xlink"><mets:fileSec><mets:fileGrp ID="PAGEXML"><mets:fileGrp ID="PAGEXML">${names.map((n, i) => `<mets:file ID="PAGEXML_${i}"><mets:FLocat LOCTYPE="OTHER" xlink:href="page/${n}"/></mets:file>`).join("")}</mets:fileGrp></mets:fileGrp></mets:fileSec></mets:mets>`;

async function zipOf(entries) {
  const z = new JSZip();
  for (const [p, d] of Object.entries(entries)) z.file(p, d);
  return new Uint8Array(await z.generateAsync({ type: "uint8array" }));
}

let library, png, pdf, pdfPages;
beforeEach(async () => {
  library = createEvidenceLibrary(freshStorage());
  png = (await library.copies.registerFile(new TextEncoder().encode("png"), { fileName: "pag32-upright.png", storage: { mode: "blob", blobKey: "a" } })).copy;
  await library.pages.addPage({ copyId: png.id, pageIndex: 0, width: 1475, height: 2320 });
  pdf = (await library.copies.registerFile(new TextEncoder().encode("pdf"), { fileName: "Registru decese 1866.pdf", storage: { mode: "blob", blobKey: "b" } })).copy;
  pdfPages = [];
  for (let i = 0; i < 3; i++) pdfPages.push((await library.pages.addPage({ copyId: pdf.id, pageIndex: i, width: 595, height: 842 })).page);
});

describe("Transkribus export: reading (P7b.T2)", () => {
  it("reads a ZIP export in METS order, skipping images and non-PAGE files", async () => {
    const names = ["0002_scan.xml", "0010_scan.xml", "0001_scan.xml"];
    const zip = await zipOf({
      "1234567/Registru/mets.xml": METS(["0001_scan.xml", "0002_scan.xml", "0010_scan.xml"]),
      "1234567/Registru/doc.xml": "<trpDoc/>",
      "1234567/Registru/0001_scan.jpg": new Uint8Array([1, 2]),
      ...Object.fromEntries(names.map((n) => [`1234567/Registru/page/${n}`, pageXml(n.replace(".xml", ".jpg"), 1000, 1414, `text ${n}`)])),
    });
    const r = await readExport([file("export_1234567.zip", zip)]);
    expect(r.usedMets).toBe(true);
    expect(r.pages.map((p) => p.file)).toEqual(["0001_scan.xml", "0002_scan.xml", "0010_scan.xml"]);
    expect(r.errors).toEqual([]);
  });

  it("reads loose XML files in natural name order and reports broken ones", async () => {
    const r = await readExport([file("p10.xml", pageXml("p10.jpg", 10, 10, "b")), file("p2.xml", pageXml("p2.jpg", 10, 10, "a")), file("bad.xml", fx("broken.xml")), file("notes.txt", "x")]);
    expect(r.pages.map((p) => p.file)).toEqual(["p2.xml", "p10.xml"]);
    expect(r.errors.map((e) => e.source)).toEqual(["notes.txt", "bad.xml"]);
  });

  it("helpers: name keys, METS order, aspect check", () => {
    expect(nameKeys("0007_Pag32-Upright.PNG")).toEqual(["0007_pag32-upright", "pag32-upright"]);
    expect(metsOrder(METS(["a.xml", "b.xml"]))).toEqual(["a.xml", "b.xml"]);
    expect(aspectCheck({ width: 1475, height: 2320 }, { width: 1500, height: 2350 })).toEqual({ ok: true, rotated: false });
    expect(aspectCheck({ width: 2320, height: 1475 }, { width: 1475, height: 2320 })).toEqual({ ok: false, rotated: true });
  });
});

describe("Transkribus export: matching (P7b.T2)", () => {
  it("matches an image document by file name (with or without the Transkribus number prefix)", async () => {
    const r = await readExport([file("0001_pag32-upright.xml", fx("p32-2013.xml"))]);
    const m = await matchPages({ library, exportPages: r.pages });
    expect(m.matched).toEqual([expect.objectContaining({ copy: expect.objectContaining({ id: png.id }), via: "file name", aspect: { ok: true, rotated: false } })]);
    expect(m.unmatched).toEqual([]);
  });

  it("pages of a PDF are matched by order only after the document is chosen; counts are compared", async () => {
    const r = await readExport([file("a.xml", pageXml("Registru_p1.jpg", 1240, 1754, "unu")), file("b.xml", pageXml("Registru_p2.jpg", 1240, 1754, "doi"))]);
    const unchosen = await matchPages({ library, exportPages: r.pages });
    expect(unchosen.matched).toEqual([]);
    expect(unchosen.unmatched[0].reason).toMatch(/no document named "Registru_p1.jpg"; pick a document/);
    const chosen = await matchPages({ library, exportPages: r.pages, copyId: pdf.id });
    expect(chosen.matched.map((x) => [x.page.pageIndex, x.via, x.aspect.ok])).toEqual([[0, "page order", true], [1, "page order", true]]);
    expect(chosen.warnings[0]).toMatch(/2 pages to place and "Registru decese 1866.pdf" has 3/);
  });

  it("refuses ambiguous names and documents not read yet; flags a different or rotated image", async () => {
    const twin = (await library.copies.registerFile(new TextEncoder().encode("png2"), { fileName: "pag32-upright.png", storage: { mode: "blob", blobKey: "c" } })).copy;
    let r = await readExport([file("x.xml", fx("p32-2013.xml"))]);
    expect((await matchPages({ library, exportPages: r.pages })).unmatched[0].reason).toMatch(/2 documents have that file name/);
    expect(twin).toBeTruthy();

    const lib2 = createEvidenceLibrary(freshStorage());
    await lib2.copies.registerFile(new TextEncoder().encode("png"), { fileName: "pag32-upright.png", storage: { mode: "blob", blobKey: "a" } });
    expect((await matchPages({ library: lib2, exportPages: r.pages })).unmatched[0].reason).toMatch(/has not been read yet/);

    const lib3 = createEvidenceLibrary(freshStorage());
    const c3 = (await lib3.copies.registerFile(new TextEncoder().encode("png"), { fileName: "pag32-upright.png", storage: { mode: "blob", blobKey: "a" } })).copy;
    await lib3.pages.addPage({ copyId: c3.id, pageIndex: 0, width: 2320, height: 1475 });   // stored sideways
    const m3 = await matchPages({ library: lib3, exportPages: r.pages });
    expect(m3.matched[0].aspect).toEqual({ ok: false, rotated: true });
  });
});
