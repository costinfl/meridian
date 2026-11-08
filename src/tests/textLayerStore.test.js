import { describe, it, expect, beforeEach } from "vitest";
import { freshStorage } from "./evidenceHelpers.js";
import { createCopyStore } from "../evidence/repositories/copyStore.js";
import { createPageStore } from "../evidence/repositories/pageStore.js";
import { createRunStore } from "../evidence/repositories/runStore.js";
import { createTextLayerStore, pickCurrent } from "../evidence/repositories/textLayerStore.js";

let storage, pages, runs, texts, page, whole, runA, runB;
beforeEach(async () => {
  storage = freshStorage();
  const copy = (await createCopyStore(storage).registerFile(new TextEncoder().encode("pdf"), { storage: { mode: "blob", blobKey: "k" } })).copy;
  pages = createPageStore(storage); runs = createRunStore(storage); texts = createTextLayerStore(storage);
  ({ page, wholePageRegion: whole } = await pages.addPage({ copyId: copy.id, pageIndex: 0, width: 100, height: 100 }));
  runA = await runs.startRun({ processor: "pdf-text" });
  runB = await runs.startRun({ processor: "tesseract" });
});

describe("TextLayer: creation and invariants", () => {
  it("stores original and normalised text, language, script, confidence and word boxes", async () => {
    const l = await texts.add({
      regionId: whole.id, runId: runA.id, originalText: "Ştefan Hariton", normalizedText: "ștefan hariton",
      language: "ro", script: "latin", confidence: 0.93,
      words: [{ text: "Ştefan", box: { x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.15 } }, { text: "Hariton", box: { x0: 0.32, y0: 0.1, x1: 0.6, y1: 0.15 } }],
    });
    expect(await texts.get(l.id)).toEqual(l);
    expect(l).toMatchObject({ originalText: "Ştefan Hariton", normalizedText: "ștefan hariton", language: "ro", confidence: 0.93, supersedesId: null });
  });
  it("defaults normalised text to the original until the normaliser exists", async () => {
    expect((await texts.add({ regionId: whole.id, runId: runA.id, originalText: "abc" })).normalizedText).toBe("abc");
  });

  it("I3: a run is required and must exist; the region must exist", async () => {
    await expect(texts.add({ regionId: whole.id, originalText: "x" })).rejects.toMatchObject({ code: "invalid" });
    await expect(texts.add({ regionId: whole.id, runId: "missing", originalText: "x" })).rejects.toMatchObject({ code: "not-found" });
    await expect(texts.add({ regionId: "missing", runId: runA.id, originalText: "x" })).rejects.toMatchObject({ code: "not-found" });
    expect(await storage.dbCount("evTextLayers")).toBe(0);
  });
  it("validates text, confidence and word boxes (I4)", async () => {
    const base = { regionId: whole.id, runId: runA.id };
    await expect(texts.add({ ...base, originalText: 5 })).rejects.toMatchObject({ code: "invalid" });
    await expect(texts.add({ ...base, originalText: "x", confidence: 1.2 })).rejects.toMatchObject({ code: "invalid" });
    await expect(texts.add({ ...base, originalText: "x", words: [{ text: "a", box: { x0: 0.5, y0: 0, x1: 0.2, y1: 1 } }] })).rejects.toThrow(/box/);
    await expect(texts.add({ ...base, originalText: "x", words: "nope" })).rejects.toMatchObject({ code: "invalid" });
    expect((await texts.add({ ...base, originalText: "" })).originalText).toBe(""); // empty page text is a valid result
  });
});

describe("TextLayer: I1 append-only", () => {
  it("exposes no update, delete, put or set operation", () => {
    expect(Object.keys(texts).filter((k) => /^(update|delete|remove|put|set|save|edit|replace)/i.test(k))).toEqual([]);
  });
  it("the store rejects re-inserting an existing id, so content can never be overwritten", async () => {
    const l = await texts.add({ regionId: whole.id, runId: runA.id, originalText: "first" });
    await expect(storage.dbAdd("evTextLayers", { ...l, originalText: "tampered" })).rejects.toBeTruthy();
    expect((await texts.get(l.id)).originalText).toBe("first");
  });
  it("a correction supersedes: the old layer stays, the new one becomes current", async () => {
    const old = await texts.add({ regionId: whole.id, runId: runB.id, originalText: "Hariton Dumitru, nascut 1850", confidence: 0.6 });
    const fixed = await texts.add({ regionId: whole.id, runId: runA.id, originalText: "Hariton Dumitru, născut 1850", supersedesId: old.id });
    expect((await texts.get(old.id)).originalText).toBe("Hariton Dumitru, nascut 1850"); // untouched
    expect((await texts.current(whole.id)).id).toBe(fixed.id);
    expect((await texts.listByRegion(whole.id)).map((l) => l.id)).toEqual([old.id, fixed.id]);
  });
  it("a layer can be superseded only once, only within its region, and the target must exist", async () => {
    const other = await pages.addRegion({ pageId: page.id, box: { x0: 0, y0: 0, x1: 0.5, y1: 0.5 }, kind: "block" });
    const a = await texts.add({ regionId: whole.id, runId: runA.id, originalText: "a" });
    await texts.add({ regionId: whole.id, runId: runA.id, originalText: "a2", supersedesId: a.id });
    await expect(texts.add({ regionId: whole.id, runId: runA.id, originalText: "a3", supersedesId: a.id })).rejects.toMatchObject({ code: "conflict" });
    await expect(texts.add({ regionId: other.id, runId: runA.id, originalText: "b", supersedesId: a.id })).rejects.toMatchObject({ code: "invalid" });
    await expect(texts.add({ regionId: whole.id, runId: runA.id, originalText: "c", supersedesId: "missing" })).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("TextLayer: current layer query", () => {
  it("with several unsuperseded layers (different runs) the newest is current", async () => {
    const fromPdf = await texts.add({ regionId: whole.id, runId: runA.id, originalText: "embedded" });
    const fromOcr = await texts.add({ regionId: whole.id, runId: runB.id, originalText: "ocr" });
    expect((await texts.current(whole.id)).id).toBe(fromOcr.id);
    expect((await texts.listByRegion(whole.id)).map((l) => l.id)).toEqual([fromPdf.id, fromOcr.id]);
    expect(await texts.current("no-text-region")).toBeNull();
  });
  it("superseding an older layer does not hide a newer unsuperseded one", async () => {
    const a = await texts.add({ regionId: whole.id, runId: runA.id, originalText: "a" });
    const b = await texts.add({ regionId: whole.id, runId: runB.id, originalText: "b" });
    await texts.add({ regionId: whole.id, runId: runA.id, originalText: "a-fixed", supersedesId: a.id });
    // a-fixed is the newest of the live layers [b, a-fixed]
    expect((await texts.current(whole.id)).originalText).toBe("a-fixed");
    expect(pickCurrent([])).toBeNull();
    expect(b.id).toBeTruthy();
  });
  it("currentForPage returns the current layer for each region that has text", async () => {
    const article = await pages.addRegion({ pageId: page.id, box: { x0: 0, y0: 0, x1: 0.5, y1: 0.5 }, kind: "article" });
    const empty = await pages.addRegion({ pageId: page.id, box: { x0: 0.5, y0: 0.5, x1: 1, y1: 1 }, kind: "block" });
    const w1 = await texts.add({ regionId: whole.id, runId: runA.id, originalText: "page text v1" });
    const w2 = await texts.add({ regionId: whole.id, runId: runA.id, originalText: "page text v2", supersedesId: w1.id });
    const art = await texts.add({ regionId: article.id, runId: runB.id, originalText: "article text" });
    const map = await texts.currentForPage(page.id);
    expect(Object.keys(map).sort()).toEqual([whole.id, article.id].sort());
    expect(map[whole.id].id).toBe(w2.id);
    expect(map[article.id].id).toBe(art.id);
    expect(map[empty.id]).toBeUndefined();
  });
  it("listByRun returns the layers a run produced", async () => {
    await texts.add({ regionId: whole.id, runId: runA.id, originalText: "x" });
    await texts.add({ regionId: whole.id, runId: runB.id, originalText: "y" });
    expect((await texts.listByRun(runB.id)).map((l) => l.originalText)).toEqual(["y"]);
  });
});

describe("createEvidenceLibrary", () => {
  it("wires every store to one storage service and works end to end", async () => {
    const { createEvidenceLibrary } = await import("../evidence/index.js");
    const lib = createEvidenceLibrary(freshStorage());
    const src = await lib.sources.create({ kind: "parish-register", title: "Botezuri 1843" });
    const { copy } = await lib.copies.registerFile(new TextEncoder().encode("scan"), { sourceId: src.id, storage: { mode: "blob", blobKey: "k" } });
    const { page, wholePageRegion } = await lib.pages.addPage({ copyId: copy.id, pageIndex: 0, width: 1000, height: 1400 });
    const run = await lib.runs.startRun({ processor: "tesseract", processorVersion: "7.0.0" });
    await lib.runs.addItem({ runId: run.id, pageId: page.id, status: "succeeded" });
    await lib.textLayers.add({ regionId: wholePageRegion.id, runId: run.id, originalText: "Ştefan" });
    await lib.runs.finishRun(run.id, "succeeded");
    expect((await lib.textLayers.current(wholePageRegion.id)).originalText).toBe("Ştefan");
  });
});
