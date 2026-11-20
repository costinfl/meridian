import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { freshStorage } from "./evidenceHelpers.js";
import { createEvidenceLibrary } from "../evidence/index.js";
import { readExport, matchPages, importTranskribus, describeImport } from "../ingest/transkribus/index.js";
import { createSearchService } from "../search/index.js";
import { checkUserActionOnly } from "./archRules.js";

const fx = (n) => fs.readFileSync(path.join(__dirname, "fixtures", "transkribus", n), "utf8");
const file = (name, text) => ({ name, text: async () => text, arrayBuffer: async () => new TextEncoder().encode(text).buffer });

let library, png, page, whole, ocr;
beforeEach(async () => {
  library = createEvidenceLibrary(freshStorage());
  png = (await library.copies.registerFile(new TextEncoder().encode("png"), { fileName: "pag32-upright.png", storage: { mode: "blob", blobKey: "a" } })).copy;
  ({ page, wholePageRegion: whole } = await library.pages.addPage({ copyId: png.id, pageIndex: 0, width: 1475, height: 2320 }));
  const run = await library.runs.startRun({ processor: "tesseract" });
  ocr = await library.textLayers.add({ regionId: whole.id, runId: run.id, originalText: "REGISTRU STAREKI CIVILE noise", confidence: 0.34 });
});
const matchesFor = async (xml = fx("p32-2013.xml")) => (await matchPages({ library, exportPages: (await readExport([file("0001_pag32-upright.xml", xml)])).pages })).matched;

describe("Transkribus import (P7b.T3)", () => {
  it("adds a transcription layer with the page text and positioned lines, a transkribus run with the model, and the raw PAGE XML", async () => {
    const r = await importTranskribus({ library, matches: await matchesFor(), exportName: "export_1234567.zip" });
    expect(r).toMatchObject({ imported: 1, skipped: 0, failed: [] });
    const layer = await library.textLayers.current(whole.id);
    expect(layer.originalText).toMatch(/^Actu de încetare din viață\.\n\nAnulu una mie optu sute/);
    expect(layer.words).toHaveLength(4);
    expect(layer.words[1]).toEqual({ text: "Anulu una mie optu sute șaizeci și șase la douădieci și optu ale lunii", box: { x0: 0.088136, y0: 0.150862, x1: 0.942373, y1: 0.172414 } });
    expect(layer).toMatchObject({ kind: "transcription", language: "ro", confidence: null });
    const run = await library.runs.getRun(r.runId);
    expect(run).toMatchObject({ processor: "transkribus", processorVersion: "page-xml-1", status: "succeeded", parameters: { exportName: "export_1234567.zip", pages: 1 } });
    expect(run.modelId).toMatch(/PyLaia/);
    const [item] = await library.runs.listItems(r.runId);
    expect(item.result).toMatchObject({ via: "file name", lines: 4, file: "0001_pag32-upright.xml" });
    expect(new TextDecoder().decode((await library.runs.getRawOutput(item.rawOutputId)).bytes)).toBe(fx("p32-2013.xml"));
    expect(await library.textLayers.get(ocr.id)).toEqual(ocr);                          // OCR untouched
    expect(await library.textLayers.current(whole.id, "reading")).toBeNull();           // no reading made (I6)
  });

  it("the same XML is not imported twice; a changed export adds a newer layer", async () => {
    await importTranskribus({ library, matches: await matchesFor() });
    const again = await importTranskribus({ library, matches: await matchesFor() });
    expect(again).toMatchObject({ imported: 0, skipped: 1 });
    expect(describeImport(again, 2)).toBe("Imported 0 pages; 1 already imported; 2 not matched.");
    const changed = fx("p32-2013.xml").replace("Șfatu Loti", "Sfatu Loti (corectat)");
    expect((await importTranskribus({ library, matches: await matchesFor(changed) })).imported).toBe(1);
    expect((await library.textLayers.listByRegion(whole.id, "transcription")).map((l) => l.originalText.includes("corectat"))).toEqual([false, false, true]);
  });

  it("search finds the imported text", async () => {
    await importTranskribus({ library, matches: await matchesFor() });
    const svc = createSearchService(library);
    await svc.ensure();
    const hits = (await svc.query({ q: "Loti catolica" })).hits;
    expect(hits.map((h) => h.id)).toEqual([whole.id]);
  });

  it("I6: the importer may not take user decisions (architecture rule)", () => {
    expect(checkUserActionOnly({ "ingest/transkribus/x.js": "await library.textLayers.startReading({ regionId })" })).toHaveLength(1);
  });
});

describe("Start the reading from the Transkribus text (Phase 7b review, b)", () => {
  it("startReading from a chosen transcription; refused for another region's layer or when a reading exists", async () => {
    const r = await importTranskribus({ library, matches: await matchesFor(), exportName: "x.zip" });
    expect(r.imported).toBe(1);
    // the OCR layer is chosen explicitly: the reading starts from it, not from the newer Transkribus text
    const fromOcr = await library.textLayers.startReading({ regionId: whole.id, fromLayerId: ocr.id });
    expect(fromOcr.originalText).toBe("REGISTRU STAREKI CIVILE noise");
    expect(fromOcr.startedFromLayerId).toBe(ocr.id);
    await expect(library.textLayers.startReading({ regionId: whole.id })).rejects.toThrow(/already has a reading/);
  });

  it("by default the newest (Transkribus) transcription; a foreign layer id is refused", async () => {
    await importTranskribus({ library, matches: await matchesFor(), exportName: "x.zip" });
    await expect(library.textLayers.startReading({ regionId: whole.id, fromLayerId: "nope" })).rejects.toThrow(/not a transcription of this region/);
    const reading = await library.textLayers.startReading({ regionId: whole.id });
    expect(reading.originalText).toMatch(/^Actu de încetare din viață/);
  });
});
