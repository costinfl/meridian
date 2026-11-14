// @vitest-environment node
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { freshStorage } from "./evidenceHelpers.js";
import { fakeDirectory, memoryDeviceStorage, fixtureBytes } from "./ingestHelpers.js";
import { nodeEngines } from "./nodeEngines.js";
import { createEvidenceLibrary, normalizedBox } from "../evidence/index.js";
import { openDocument } from "../ingest/documents.js";
import { scanEntries } from "../ingest/scanner.js";
import { walkFolder } from "../ingest/folder.js";
import { assessText, isPlausibleToken } from "../ingest/quality.js";
import { processCopy, listRunsWithItems, rerunTargetOf } from "../ingest/pipeline.js";
import { VERSIONS } from "../ingest/versions.js";

let engines, storage, library;
beforeAll(async () => { engines = await nodeEngines(); });
beforeEach(() => { storage = memoryDeviceStorage(freshStorage()); library = createEvidenceLibrary(storage); });

/** OCR stub shaped like the browser engine's result (pixel boxes on the image it was given). */
function stubOcr({ fail = () => false } = {}) {
  const calls = [];
  return {
    calls, languages: ["ron"], version: "7.0.0-test", model: "ron test",
    async recognize(img) {
      calls.push(img);
      if (fail(calls.length)) throw new Error("OCR engine crashed");
      const w = img.width, h = img.height;
      return {
        text: "Ștefan Hariton, născut la 1850\nîn Ploiești\n", confidence: 93,
        words: [
          { text: "Ștefan", bbox: { x0: 0.04 * w, y0: 0.15 * h, x1: 0.14 * w, y1: 0.28 * h }, confidence: 95 },
          { text: "Hariton,", bbox: { x0: 0.15 * w, y0: 0.15 * h, x1: 0.29 * w, y1: 0.28 * h }, confidence: 94 },
          { text: "degenerate", bbox: { x0: 10, y0: 10, x1: 10, y1: 10 }, confidence: 1 },
        ],
        raw: JSON.stringify({ engine: "stub", text: "Ștefan Hariton" }), rawMediaType: "application/json",
      };
    },
  };
}
/** In Node there is no PDF renderer: give scanned PDFs a fake rendered image so OCR has something to read. */
const withRenderer = (doc) => ({ ...doc, pageImage: async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg", width: 1000, height: 300 }) });

async function setup(name, { sidecar, render = false } = {}) {
  const tree = { [name]: fixtureBytes(name) };
  if (sidecar) tree[`${name}.meta.json`] = JSON.stringify(sidecar);
  const r = await scanEntries({ library, entries: walkFolder(fakeDirectory(tree)) });
  const copy = await library.copies.get(r.added[0].copyId);
  let doc = await openDocument({ fileName: name, bytes: fixtureBytes(name), engines });
  if (render) doc = withRenderer(doc);
  return { copy, doc };
}
const layersOf = async (copy) => {
  const out = [];
  for (const p of await library.pages.listPages(copy.id)) out.push(await library.textLayers.current((await library.pages.wholePageRegion(p.id)).id));
  return out;
};

describe("text quality check (router)", () => {
  it("accepts real text in several languages and rejects garbage or too little text", () => {
    expect(assessText("Ștefan Hariton, născut la 12 Martie 1850, fiul lui Dumitru și al Mariei.")).toMatchObject({ ok: true, plausibleShare: 1 });
    expect(assessText("Kovács János született 1885. március 1-én Kolozsvárott").ok).toBe(true);
    expect(assessText("The register of baptisms, vol. 3, pp. 12-14 (1843)").ok).toBe(true);
    const garbage = assessText("□□□ ▯▯ \u0001\u0002 x#q@ zzkq ~~|| ﬁ§¶ qwrtp bcdfg 8#8#8 ]]][[[ ‡‡ pqrst vwxz");
    expect(garbage.ok).toBe(false);
    expect(garbage.reason).toMatch(/looks like words/);
    expect(assessText("f. 23")).toMatchObject({ ok: false });
    expect(assessText("f. 23").reason).toMatch(/characters/);
    expect(assessText("")).toMatchObject({ ok: false, chars: 0, tokens: 0 });
    expect(assessText(null).ok).toBe(false);
  });
  it("is configurable and judges tokens sensibly", () => {
    const mixed = "Hariton xqzt Ploiești bcdf 1850 wrtk";       // half plausible
    expect(assessText(mixed, { minPlausibleShare: 0.4 }).ok).toBe(true);
    expect(assessText(mixed, { minPlausibleShare: 0.8 }).ok).toBe(false);
    expect(assessText("da", { minChars: 2 }).ok).toBe(true);
    for (const t of ["Ploiești,", "(1850)", "s-a", "12.03.1850", "ANPh", "a", "d'Arc"]) expect(isPlausibleToken(t), t).toBe(true);
    for (const t of ["xqzt", "a#b", "###", "", "qwrtpsdfghjklzxcvbnmqwrtpsdfghjklzxcvbnm"]) expect(isPlausibleToken(t), t).toBe(false);
  });
});

describe("pipeline: router + text processors (P5.T4, P5.T5)", () => {
  it("text PDF: the router chooses the embedded text; pdf-text writes a text layer per page with word boxes and raw output", async () => {
    const { copy, doc } = await setup("text.pdf");
    const ocr = stubOcr();
    const s = await processCopy({ library, copy, doc, ocr });
    expect(s.pages.map((p) => [p.pageIndex, p.classification, p.processor, p.status])).toEqual([[0, "embedded-text", "pdf-text", "succeeded"], [1, "embedded-text", "pdf-text", "succeeded"]]);
    expect(ocr.calls).toHaveLength(0);
    expect(s.runIds).toHaveLength(2);

    const [router, text] = await Promise.all(s.runIds.map((id) => library.runs.getRun(id)));
    expect(router).toMatchObject({ processor: "router", status: "succeeded", processorVersion: VERSIONS.router });
    expect(router.parameters.quality).toEqual({ minChars: 20, minPlausibleShare: 0.6 });
    const routerItems = await library.runs.listItems(router.id);
    expect(routerItems).toHaveLength(2);
    expect(routerItems[0].result).toMatchObject({ classification: "embedded-text", processor: "pdf-text", quality: { ok: true } });   // classification recorded per page
    expect(text).toMatchObject({ processor: "pdf-text", status: "succeeded", processorVersion: VERSIONS.pdfjs });

    const layers = await layersOf(copy);
    expect(layers[0]).toMatchObject({ runId: text.id, confidence: null, supersedesId: null });
    expect(layers[0].originalText).toContain("Ștefan Hariton, născut la 12 Martie 1850");
    expect(layers[0].words.length).toBeGreaterThan(20);
    for (const w of layers[0].words) expect(() => normalizedBox(w.box)).not.toThrow();
    expect(layers[1].originalText).toContain("Elena Băltăceanu");
    const item = (await library.runs.listItems(text.id))[0];
    expect(item).toMatchObject({ status: "succeeded", error: "" });
    const raw = await library.runs.getRawOutput(item.rawOutputId);
    expect(JSON.parse(new TextDecoder().decode(raw.bytes)).text).toBe(layers[0].originalText);          // raw output round-trips
    expect((await library.copies.get(copy.id)).pageCount).toBe(2);
  });

  it("scanned PDF: no embedded text, so the page goes to OCR; word boxes are normalised and raw output is stored", async () => {
    const { copy, doc } = await setup("scanned.pdf", { render: true });
    const ocr = stubOcr();
    const s = await processCopy({ library, copy, doc, ocr });
    expect(s.pages).toMatchObject([{ classification: "needs-ocr", processor: "tesseract", status: "succeeded" }]);
    expect(ocr.calls).toHaveLength(1);
    expect(ocr.calls[0]).toMatchObject({ mimeType: "image/jpeg", width: 1000, height: 300 });
    const run = await library.runs.getRun(s.runIds[1]);
    expect(run).toMatchObject({ processor: "tesseract", processorVersion: "7.0.0-test", modelId: "ron test", status: "succeeded" });
    expect(run.parameters).toMatchObject({ languages: ["ron"] });                                        // versions and language recorded on the run
    const routerItem = (await library.runs.listItems(s.runIds[0]))[0];
    expect(routerItem.result).toMatchObject({ classification: "needs-ocr", quality: { ok: false, chars: 0 } });
    const [layer] = await layersOf(copy);
    expect(layer).toMatchObject({ originalText: "Ștefan Hariton, născut la 1850\nîn Ploiești", normalizedText: "Ștefan Hariton, născut la 1850 în Ploiești", confidence: 0.93, language: "ron" });
    expect(layer.words.map((w) => w.text)).toEqual(["Ștefan", "Hariton,"]);                              // the degenerate box was dropped
    expect(layer.words[0].box).toEqual({ x0: 0.04, y0: 0.15, x1: 0.14, y1: 0.28 });
    const item = (await library.runs.listItems(run.id))[0];
    expect(new TextDecoder().decode((await library.runs.getRawOutput(item.rawOutputId)).bytes)).toContain('"engine":"stub"');
    expect((await library.pageCache.stats()).entries).toBe(1);                                           // the rendered page was cached
  });

  it("image file: OCR reads the file itself", async () => {
    const { copy, doc } = await setup("scan.png");
    const ocr = stubOcr();
    const s = await processCopy({ library, copy, doc, ocr });
    expect(s.pages[0]).toMatchObject({ classification: "needs-ocr", status: "succeeded" });
    expect(ocr.calls[0]).toMatchObject({ mimeType: "image/png", width: 1000, height: 300 });
    expect(ocr.calls[0].bytes.byteLength).toBe(fixtureBytes("scan.png").byteLength);
  });

  it("DOCX: one text page through docx-text, no OCR, no word boxes", async () => {
    const { copy, doc } = await setup("note.docx");
    const ocr = stubOcr();
    const s = await processCopy({ library, copy, doc, ocr });
    expect(s.pages).toMatchObject([{ classification: "docx-text", processor: "docx-text", status: "succeeded" }]);
    expect(ocr.calls).toHaveLength(0);
    const [layer] = await layersOf(copy);
    expect(layer.originalText).toContain("Ștefan Hariton s-a născut la Săhăteni în 1850.");
    expect(layer.words).toBeNull();
    expect((await library.runs.getRun(s.runIds[1]))).toMatchObject({ processor: "docx-text", processorVersion: VERSIONS.mammoth });
  });

  it("a source flagged handwritten waits for HTR: no OCR, no text layer, item status awaiting-htr", async () => {
    const { copy, doc } = await setup("scanned.pdf", { render: true, sidecar: { sourceTitle: "Registru manuscris", handwritten: true } });
    const ocr = stubOcr();
    const s = await processCopy({ library, copy, doc, ocr });
    expect(s.pages).toMatchObject([{ classification: "handwritten", processor: null, status: "awaiting-htr" }]);
    expect(ocr.calls).toHaveLength(0);
    expect(s.runIds).toHaveLength(1);                                                                     // router only
    expect((await library.runs.listItems(s.runIds[0]))[0]).toMatchObject({ status: "awaiting-htr", result: { classification: "handwritten" } });
    expect(await layersOf(copy)).toEqual([null]);
    // even a handwritten source with good embedded text waits: the flag wins
    const typed = await setup("text.pdf", { sidecar: { sourceTitle: "Registru manuscris", handwritten: true } });
    expect((await processCopy({ library, copy: typed.copy, doc: typed.doc, ocr })).pages.every((p) => p.classification === "handwritten")).toBe(true);
  });

  it("embedded text that fails the quality check is sent to OCR instead", async () => {
    const { copy, doc } = await setup("text.pdf", { render: true });
    const ocr = stubOcr();
    const s = await processCopy({ library, copy, doc, ocr, quality: { minPlausibleShare: 1.01 } });   // nothing can pass
    expect(s.pages.map((p) => p.classification)).toEqual(["needs-ocr", "needs-ocr"]);
    expect(ocr.calls).toHaveLength(2);
    expect((await library.runs.listItems(s.runIds[0]))[0].result.quality).toMatchObject({ ok: false });
  });

  it("processing a copy twice adds nothing; force re-reads and the newest layer becomes current", async () => {
    const { copy, doc } = await setup("text.pdf");
    await processCopy({ library, copy, doc });
    const before = await storage.dbCount("evTextLayers");
    const again = await processCopy({ library, copy: await library.copies.get(copy.id), doc });
    expect(again.pages.map((p) => [p.classification, p.status])).toEqual([["already-has-text", "skipped"], ["already-has-text", "skipped"]]);
    expect(again.runIds).toHaveLength(1);
    expect(await storage.dbCount("evTextLayers")).toBe(before);
    expect(await storage.dbCount("evPages")).toBe(2);
    const forced = await processCopy({ library, copy, doc, force: true });
    expect(forced.pages.every((p) => p.status === "succeeded")).toBe(true);
    expect(await storage.dbCount("evTextLayers")).toBe(before + 2);                                        // append-only: old layers stay
    const [l0] = await layersOf(copy);
    expect(l0.runId).toBe(forced.runIds[1]);
  });

  it("a failed page fails only its item; the run is partial; the failed item is re-run as a one-page batch", async () => {
    const { copy, doc } = await setup("text.pdf", { render: true });
    const ocr = stubOcr({ fail: (n) => n === 1 });                                                        // first OCR call crashes
    const s = await processCopy({ library, copy, doc, ocr, processor: "tesseract" });
    expect(s.pages.map((p) => [p.pageIndex, p.status, p.error])).toEqual([[0, "failed", "OCR engine crashed"], [1, "succeeded", ""]]);
    const run = await library.runs.getRun(s.runIds[1]);
    expect(run.status).toBe("partial");
    const items = await library.runs.listItems(run.id);
    const failed = items.find((i) => i.status === "failed");
    expect(failed).toMatchObject({ error: "OCR engine crashed", rawOutputId: null });
    expect((await layersOf(copy)).map((l) => !!l)).toEqual([false, true]);

    const view = await listRunsWithItems({ library, copyId: copy.id });
    expect(view.map((v) => [v.run.processor, v.failed])).toEqual([["tesseract", 1], ["router", 0]]);     // newest first
    const target = await rerunTargetOf({ library, itemId: failed.id });
    expect(target).toEqual({ copyId: copy.id, pageId: failed.pageId, processor: "tesseract" });

    const rerun = await processCopy({ library, copy, doc, ocr, pageIds: [target.pageId], processor: target.processor });
    expect(rerun.pages).toMatchObject([{ pageIndex: 0, status: "succeeded" }]);
    const rerunRun = await library.runs.getRun(rerun.runIds[1]);
    expect(rerunRun.status).toBe("succeeded");
    expect(await library.runs.listItems(rerunRun.id)).toHaveLength(1);                                    // a one-page batch
    expect((await layersOf(copy)).every(Boolean)).toBe(true);
    expect((await library.runs.getItem(failed.id)).status).toBe("failed");                                // the failure stays on record
    await expect(rerunTargetOf({ library, itemId: "nope" })).rejects.toThrow(/not found/);
  });

  it("when every page fails the run is failed; without an OCR engine OCR pages fail with a clear message", async () => {
    const { copy, doc } = await setup("scanned.pdf", { render: true });
    const s = await processCopy({ library, copy, doc, ocr: stubOcr({ fail: () => true }) });
    expect((await library.runs.getRun(s.runIds[1])).status).toBe("failed");
    const none = await processCopy({ library, copy, doc });
    expect(none.pages[0]).toMatchObject({ status: "failed", error: "OCR is not available" });
    expect(none.runIds).toHaveLength(1);
    // a page with no image cannot be OCR'd (the cache still holds the image rendered above: clear it first)
    await library.pageCache.clear();
    const bare = await processCopy({ library, copy, doc: { ...doc, pageImage: async () => null }, ocr: stubOcr() });
    expect(bare.pages[0].error).toMatch(/no image/);
  });

  it("reports progress and stops between pages when cancelled; the run is marked cancelled", async () => {
    const { copy, doc } = await setup("text.pdf", { render: true });
    const ctl = new AbortController();
    const stages = [];
    const ocr = stubOcr();
    const s = await processCopy({ library, copy, doc, ocr, processor: "tesseract", signal: ctl.signal, onProgress: (p) => { stages.push(`${p.stage}:${p.done}/${p.total}`); if (p.stage === "tesseract" && p.done === 1) ctl.abort(); } });
    expect(s.cancelled).toBe(true);
    expect(ocr.calls).toHaveLength(1);
    expect(s.pages.map((p) => p.status)).toEqual(["succeeded", "cancelled"]);
    expect((await library.runs.getRun(s.runIds[1])).status).toBe("cancelled");
    expect(stages).toEqual(expect.arrayContaining(["router:0/2", "router:1/2", "tesseract:0/2", "tesseract:1/2", "done:2/2"]));
    // continuing later picks up only the page that is still missing
    const rest = await processCopy({ library, copy, doc, ocr, processor: "tesseract" });
    expect(rest.pages.map((p) => p.status)).toEqual(["skipped", "succeeded"]);
  });

  it("recorded versions match the installed packages", () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"));
    const dep = (n) => pkg.dependencies[n].replace(/^[\^~]/, "");
    expect(VERSIONS.pdfjs).toBe(dep("pdfjs-dist"));
    expect(VERSIONS.mammoth).toBe(dep("mammoth"));
    expect(VERSIONS.tesseractJs).toBe(dep("tesseract.js"));
    expect(VERSIONS.ronTraineddata).toContain(dep("@tesseract.js-data/ron"));
  });
});
