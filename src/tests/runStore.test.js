import { describe, it, expect, beforeEach } from "vitest";
import { freshStorage } from "./evidenceHelpers.js";
import { createCopyStore } from "../evidence/repositories/copyStore.js";
import { createPageStore } from "../evidence/repositories/pageStore.js";
import { createRunStore } from "../evidence/repositories/runStore.js";
import { sha256Hex } from "../evidence/domain/hash.js";

let storage, runs, page;
beforeEach(async () => {
  storage = freshStorage();
  const copy = (await createCopyStore(storage).registerFile(new TextEncoder().encode("pdf"), { storage: { mode: "blob", blobKey: "k" } })).copy;
  page = (await createPageStore(storage).addPage({ copyId: copy.id, pageIndex: 0, width: 10, height: 10 })).page;
  runs = createRunStore(storage);
});

describe("ProcessingRun", () => {
  it("starts running with its configuration and finishes exactly once", async () => {
    const run = await runs.startRun({ processor: "tesseract", processorVersion: "7.0.0", parameters: { lang: "ron" }, schemaVersion: "tess-1" });
    expect(run).toMatchObject({ processor: "tesseract", status: "running", finishedAt: null, parameters: { lang: "ron" } });
    const done = await runs.finishRun(run.id, "succeeded");
    expect(done.status).toBe("succeeded");
    expect(done.finishedAt >= run.startedAt).toBe(true);
    expect(done.processorVersion).toBe("7.0.0");
    await expect(runs.finishRun(run.id, "failed")).rejects.toMatchObject({ code: "conflict" });
    await expect(runs.finishRun(run.id, "running")).rejects.toMatchObject({ code: "invalid" });
    await expect(runs.finishRun("missing", "failed")).rejects.toMatchObject({ code: "not-found" });
  });
  it("validates the processor and lists newest first", async () => {
    await expect(runs.startRun({ processor: "magic" })).rejects.toMatchObject({ code: "invalid" });
    const a = await runs.startRun({ processor: "router" });
    const b = await runs.startRun({ processor: "pdf-text" });
    expect((await runs.listRuns()).map((r) => r.id)).toEqual([b.id, a.id]);
  });
});

describe("ProcessingRunItem", () => {
  it("records per-page status, error, units billed and a structured result", async () => {
    const run = await runs.startRun({ processor: "router" });
    const item = await runs.addItem({ runId: run.id, pageId: page.id, status: "succeeded", result: { classification: "printed-newspaper", next: "tesseract" } });
    expect((await runs.listItems(run.id))).toEqual([item]);
    expect((await runs.itemsForPage(page.id))).toHaveLength(1);
    const failed = await runs.updateItem(item.id, { status: "failed", error: "timeout", unitsBilled: 1 });
    expect(failed).toMatchObject({ status: "failed", error: "timeout", unitsBilled: 1, runId: run.id, pageId: page.id });
    const hold = await runs.addItem({ runId: run.id, pageId: page.id, status: "awaiting-htr" });
    expect(hold.status).toBe("awaiting-htr");
  });
  it("requires an existing run, page and raw output, and a valid status", async () => {
    const run = await runs.startRun({ processor: "router" });
    await expect(runs.addItem({ runId: "missing", pageId: page.id })).rejects.toMatchObject({ code: "not-found" });
    await expect(runs.addItem({ runId: run.id, pageId: "missing" })).rejects.toMatchObject({ code: "not-found" });
    await expect(runs.addItem({ runId: run.id, pageId: page.id, rawOutputId: "missing" })).rejects.toMatchObject({ code: "not-found" });
    await expect(runs.addItem({ runId: run.id, pageId: page.id, status: "weird" })).rejects.toMatchObject({ code: "invalid" });
    expect(await storage.dbCount("evRunItems")).toBe(0);
    const item = await runs.addItem({ runId: run.id, pageId: page.id });
    await expect(runs.updateItem(item.id, { runId: "other", pageId: "other", status: "failed" })).resolves.toMatchObject({ runId: run.id, pageId: page.id });
  });
});

describe("RawOutput", () => {
  it("round-trips arbitrary bytes exactly, with size and sha256", async () => {
    const original = Uint8Array.from({ length: 256 }, (_, i) => i); // every byte value
    const meta = await runs.addRawOutput({ data: original, mediaType: "application/octet-stream", schemaVersion: "x-1" });
    expect(meta).toMatchObject({ size: 256, mediaType: "application/octet-stream", schemaVersion: "x-1" });
    expect(meta.sha256).toBe(await sha256Hex(original));
    expect(meta.bytes).toBeUndefined();
    const back = await runs.getRawOutput(meta.id);
    expect(Array.from(back.bytes)).toEqual(Array.from(original));
    expect(back.sha256).toBe(meta.sha256);
  });
  it("keeps UTF-8 text (Romanian diacritics) byte-for-byte and is independent of the caller's buffer", async () => {
    const json = '{"text":"Ștefan Hariton, născut în Ploiești"}';
    const buf = new TextEncoder().encode(json);
    const meta = await runs.addRawOutput({ data: buf, mediaType: "application/json" });
    buf.fill(0); // mutate caller's buffer after saving
    const back = await runs.getRawOutput(meta.id);
    expect(new TextDecoder().decode(back.bytes)).toBe(json);
    const viaString = await runs.addRawOutput({ data: json, mediaType: "application/json" });
    expect(viaString.sha256).toBe(meta.sha256);
  });
  it("is referenced by a run item, rejects bad input, and exposes no update/delete", async () => {
    const run = await runs.startRun({ processor: "tesseract" });
    const raw = await runs.addRawOutput({ data: "<alto/>", mediaType: "application/xml", schemaVersion: "alto-4" });
    const item = await runs.addItem({ runId: run.id, pageId: page.id, rawOutputId: raw.id, status: "succeeded" });
    expect(item.rawOutputId).toBe(raw.id);
    await expect(runs.addRawOutput({ data: 42 })).rejects.toMatchObject({ code: "invalid" });
    expect(await runs.getRawOutput("missing")).toBeNull();
    expect(Object.keys(runs).filter((k) => /raw/i.test(k) && /^(update|delete|remove|put|set)/i.test(k))).toEqual([]);
  });
});
