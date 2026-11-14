import { describe, it, expect, beforeEach } from "vitest";
import { freshStorage } from "./evidenceHelpers.js";
import { createCopyStore } from "../evidence/repositories/copyStore.js";
import { createPageStore } from "../evidence/repositories/pageStore.js";
import { createRunStore } from "../evidence/repositories/runStore.js";
import { createTextLayerStore, pickCurrent, kindOf } from "../evidence/repositories/textLayerStore.js";
import { applyCorrection, applyRewrite, checkLink, uncertainSpans, activeAnnotations } from "../evidence/domain/reading.js";
import { needsReview } from "../ingest/pipeline.js";

const OCR = "în etate șaizeci și doi ani, D-ei [Lati? Sati?] [Ifapu?] Catolică";

describe("reading helpers (P5.T7)", () => {
  it("finds bracketed fragments as uncertain", () => {
    expect(uncertainSpans(OCR).map((s) => s.text)).toEqual(["[Lati? Sati?]", "[Ifapu?]"]);
    expect(uncertainSpans("no brackets")).toEqual([]);
    expect(uncertainSpans("[…] and [a\nb]")).toEqual([{ start: 0, end: 3, text: "[…]" }]);
  });

  it("accepts only http(s) links", () => {
    expect(checkLink("")).toBe("");
    expect(checkLink("  https://arhive.example.ro/dolj/1866/p32 ")).toBe("https://arhive.example.ro/dolj/1866/p32");
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "ftp://x.org/a", "/relative", "not a url"]) {
      expect(() => checkLink(bad), bad).toThrow(/link/);
    }
  });

  it("a correction replaces the fragment and records before, after, link and note", () => {
    const start = OCR.indexOf("[Lati?"), end = OCR.indexOf(" Catolică");
    const r = applyCorrection({ text: OCR, start, end, after: "Șfatu Loti", url: "https://example.org/p32", note: "archive index", id: "a1", createdAt: "t" });
    expect(r.text).toBe("în etate șaizeci și doi ani, D-ei Șfatu Loti Catolică");
    expect(r.annotation).toEqual({ id: "a1", start, end: start + 10, before: "[Lati? Sati?] [Ifapu?]", after: "Șfatu Loti", url: "https://example.org/p32", note: "archive index", createdAt: "t" });
    expect(r.text.slice(r.annotation.start, r.annotation.end)).toBe("Șfatu Loti");
  });

  it("refuses a range outside the text, a non-change, and a bad link", () => {
    expect(() => applyCorrection({ text: "abc", start: 2, end: 5, after: "x", id: "a" })).toThrow(/inside/);
    expect(() => applyCorrection({ text: "abc", start: 2, end: 1, after: "x", id: "a" })).toThrow(/inside/);
    expect(() => applyCorrection({ text: "abc", start: 0, end: 1, after: "a", id: "a" })).toThrow(/same/);
    expect(() => applyCorrection({ text: "abc", start: 0, end: 1, after: "x", url: "javascript:x", id: "a" })).toThrow(/link/);
  });

  it("earlier annotations stay, shift, or are marked replaced when a later change touches them", () => {
    let r = applyCorrection({ text: "aaa bbb ccc", start: 0, end: 3, after: "AA", id: "first" });          // "AA bbb ccc"
    r = applyCorrection({ text: r.text, annotations: r.annotations, start: 7, end: 10, after: "CCCC", id: "third" }); // "AA bbb CCCC"
    // a change in the middle, longer than the old text: first stays, third shifts
    r = applyCorrection({ text: r.text, annotations: r.annotations, start: 3, end: 6, after: "BBBBB", id: "mid" });
    expect(r.text).toBe("AA BBBBB CCCC");
    const by = Object.fromEntries(r.annotations.map((a) => [a.id, a]));
    expect(r.text.slice(by.first.start, by.first.end)).toBe("AA");
    expect(r.text.slice(by.third.start, by.third.end)).toBe("CCCC");
    expect(r.text.slice(by.mid.start, by.mid.end)).toBe("BBBBB");
    // overlapping an earlier correction: it is kept but marked replaced
    r = applyCorrection({ text: r.text, annotations: r.annotations, start: 1, end: 4, after: "-", id: "over" });
    const first = r.annotations.find((a) => a.id === "first"), mid = r.annotations.find((a) => a.id === "mid");
    expect(first).toMatchObject({ replacedBy: "over", start: null, end: null, before: "aaa", after: "AA" });
    expect(mid).toMatchObject({ replacedBy: "over" });
    expect(activeAnnotations(r.annotations).map((a) => a.id)).toEqual(["third", "over"]);
  });

  it("a free rewrite moves annotations by the changed middle part", () => {
    const c = applyCorrection({ text: "Ion Popescu din Craiova", start: 4, end: 11, after: "Popeskul", id: "n" });
    const r = applyRewrite({ text: c.text, annotations: c.annotations, newText: "Domnul Ion Popeskul din Craiova", marker: "w" });
    expect(r.changed).toBe(true);
    const n = r.annotations[0];
    expect(r.text.slice(n.start, n.end)).toBe("Popeskul");
    const r2 = applyRewrite({ text: r.text, annotations: r.annotations, newText: "Domnul Ion Popescu din Craiova", marker: "w2" });
    expect(r2.annotations[0]).toMatchObject({ replacedBy: "w2" });
    expect(applyRewrite({ text: "x", annotations: [], newText: "x" }).changed).toBe(false);
  });
});

describe("reading layers in the store (P5.T7)", () => {
  let storage, runs, texts, whole, ocrRun, ocr;
  beforeEach(async () => {
    storage = freshStorage();
    const copy = (await createCopyStore(storage).registerFile(new TextEncoder().encode("scan"), { storage: { mode: "blob", blobKey: "k" } })).copy;
    const pages = createPageStore(storage);
    runs = createRunStore(storage); texts = createTextLayerStore(storage);
    ({ wholePageRegion: whole } = await pages.addPage({ copyId: copy.id, pageIndex: 0, width: 100, height: 100 }));
    ocrRun = await runs.startRun({ processor: "tesseract" });
    ocr = await texts.add({ regionId: whole.id, runId: ocrRun.id, originalText: OCR, language: "ron", script: "latin", confidence: 0.41 });
  });

  it("a reading starts as a copy of the transcription, written by a manual run; the transcription stays current", async () => {
    const r = await texts.startReading({ regionId: whole.id });
    expect(r).toMatchObject({ kind: "reading", originalText: OCR, startedFromLayerId: ocr.id, supersedesId: null, annotations: [], language: "ron", confidence: null });
    expect((await runs.getRun(r.runId))).toMatchObject({ processor: "manual", status: "succeeded" });    // I3
    expect((await texts.current(whole.id)).id).toBe(ocr.id);
    expect((await texts.current(whole.id, "reading")).id).toBe(r.id);
    expect(kindOf(ocr)).toBe("transcription");
    expect(kindOf({ id: "old layer without kind" })).toBe("transcription");
    await expect(texts.startReading({ regionId: whole.id })).rejects.toMatchObject({ code: "conflict" });
  });

  it("a page without text can still get a reading (typed by hand)", async () => {
    const copy = (await createCopyStore(storage).registerFile(new TextEncoder().encode("hand"), { storage: { mode: "blob", blobKey: "h" } })).copy;
    const { wholePageRegion } = await createPageStore(storage).addPage({ copyId: copy.id, pageIndex: 0, width: 10, height: 10 });
    const r = await texts.startReading({ regionId: wholePageRegion.id });
    expect(r).toMatchObject({ originalText: "", startedFromLayerId: null });
    const w = await texts.rewriteReading({ readingId: r.id, text: "Anulu una mie optu sute șaizeci și șase" });
    expect(w.originalText).toBe("Anulu una mie optu sute șaizeci și șase");
  });

  it("I1: every correction is a new layer superseding the previous reading; nothing earlier changes", async () => {
    const r0 = await texts.startReading({ regionId: whole.id });
    const start = OCR.indexOf("[Lati?"), end = OCR.indexOf(" Catolică");
    const r1 = await texts.correctReading({ readingId: r0.id, start, end, after: "Șfatu Loti", url: "https://example.org/p32", note: "archive index" });
    expect(r1).toMatchObject({ kind: "reading", supersedesId: r0.id, startedFromLayerId: ocr.id, originalText: "în etate șaizeci și doi ani, D-ei Șfatu Loti Catolică" });
    expect(r1.normalizedText).toBe(r1.originalText);
    expect(r1.annotations).toHaveLength(1);
    expect(await texts.get(r0.id)).toEqual(r0);
    expect(await texts.get(ocr.id)).toEqual(ocr);
    expect((await texts.current(whole.id, "reading")).id).toBe(r1.id);
    expect((await texts.current(whole.id)).id).toBe(ocr.id);
    expect((await texts.listByRegion(whole.id, "reading")).map((l) => l.id)).toEqual([r0.id, r1.id]);
    expect(await texts.listByRegion(whole.id)).toHaveLength(3);
    expect((await runs.getRun(r1.runId)).parameters).toMatchObject({ action: "correct", annotationId: r1.annotations[0].id });
  });

  it("only the newest reading can be changed; stale or wrong ids are refused", async () => {
    const r0 = await texts.startReading({ regionId: whole.id });
    await texts.correctReading({ readingId: r0.id, start: 0, end: 2, after: "In" });
    await expect(texts.correctReading({ readingId: r0.id, start: 0, end: 2, after: "ÎN" })).rejects.toMatchObject({ code: "conflict" });
    await expect(texts.rewriteReading({ readingId: ocr.id, text: "x" })).rejects.toMatchObject({ code: "not-found" });
    await expect(texts.correctReading({ readingId: "missing", start: 0, end: 1, after: "x" })).rejects.toMatchObject({ code: "not-found" });
  });

  it("a reading and a transcription never supersede each other; add() writes transcriptions only", async () => {
    const r0 = await texts.startReading({ regionId: whole.id });
    await expect(texts.add({ regionId: whole.id, runId: ocrRun.id, originalText: "x", supersedesId: r0.id })).rejects.toThrow(/never supersede/);
    await expect(texts.add({ regionId: whole.id, runId: ocrRun.id, originalText: "x", kind: "reading" })).rejects.toMatchObject({ code: "invalid" });
    // a new OCR pass supersedes the old transcription and leaves the reading alone
    const again = await texts.add({ regionId: whole.id, runId: ocrRun.id, originalText: "better OCR", supersedesId: ocr.id });
    expect((await texts.current(whole.id)).id).toBe(again.id);
    expect((await texts.current(whole.id, "reading")).id).toBe(r0.id);
    expect(pickCurrent([ocr, again, r0]).id).toBe(again.id);
  });

  it("a rewrite that changes nothing adds no version", async () => {
    const r0 = await texts.startReading({ regionId: whole.id });
    expect((await texts.rewriteReading({ readingId: r0.id, text: OCR })).id).toBe(r0.id);
    expect(await texts.listByRegion(whole.id, "reading")).toHaveLength(1);
  });
});

describe("needsReview: doubtful OCR is flagged", () => {
  it("flags low confidence or text that does not look like words; embedded text is not judged", () => {
    expect(needsReview({ originalText: "Anulu una mie optu sute", confidence: 0.35 })).toBe(true);
    // real OCR noise from a handwritten 1866 register page: looks word-like to the word check, so confidence decides
    expect(needsReview({ originalText: "d NANE EI £\nAle 4 NE NA Ale Ţ\nTI SURD ERE FIN E", confidence: 0.36 })).toBe(true);
    expect(needsReview({ originalText: "N3ANE x7q@ 3bz# kk%p zz", confidence: 0.7 })).toBe(true);
    expect(needsReview({ originalText: "Ștefan Hariton s-a născut la Săhăteni", confidence: 0.92 })).toBe(false);
    expect(needsReview({ originalText: "anything", confidence: null })).toBe(false);
    expect(needsReview(null)).toBe(false);
  });
});
