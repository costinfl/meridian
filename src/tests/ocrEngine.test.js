import { describe, it, expect, vi } from "vitest";
import { createBrowserOcr } from "../ingest/ocrEngine.browser.js";

const okData = { text: "Ștefan Hariton\n", confidence: 91, blocks: [{ paragraphs: [{ lines: [{ words: [{ text: "Ștefan", bbox: { x0: 1, y0: 2, x1: 30, y1: 12 }, confidence: 95 }] }] }] }] };

/** A fake tesseract.js module. `mode`: ok | hang (createWorker never settles, like the real bug) | report (error via errorHandler) */
function fakeTesseract(mode, { recognize } = {}) {
  const calls = { create: 0, terminate: 0, options: null };
  const worker = { recognize: recognize ?? (async () => ({ data: okData })), terminate: async () => { calls.terminate++; } };
  const createWorker = (langs, oem, options) => {
    calls.create++; calls.options = options; calls.langs = langs;
    if (mode === "ok") return Promise.resolve(worker);
    if (mode === "report") setTimeout(() => options.errorHandler("Network error while fetching /meridian/ocr/lang/ron.traineddata.gz. Response code: 404"), 5);
    return new Promise(() => {});                     // never settles
  };
  return { calls, load: async () => ({ default: { createWorker } }) };
}
const img = { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" };

describe("browser OCR engine wrapper", () => {
  it("recognises with self-hosted assets and returns words with pixel boxes and a raw JSON record", async () => {
    const t = fakeTesseract("ok");
    const ocr = createBrowserOcr({ loadTesseract: t.load });
    const r = await ocr.recognize(img);
    expect(r).toMatchObject({ text: "Ștefan Hariton\n", confidence: 91, rawMediaType: "application/json" });
    expect(r.words).toEqual([{ text: "Ștefan", bbox: { x0: 1, y0: 2, x1: 30, y1: 12 }, confidence: 95 }]);
    expect(JSON.parse(r.raw)).toMatchObject({ engine: "tesseract.js", languages: ["ron"] });
    expect(t.calls.langs).toEqual(["ron"]);
    expect(t.calls.options.langPath).toMatch(/ocr\/lang$/);
    expect(t.calls.options.corePath).toMatch(/ocr\/core$/);
    expect(t.calls.options.workerPath).toMatch(/ocr\/worker\.min\.js$/);
    expect(typeof t.calls.options.errorHandler).toBe("function");
    await ocr.recognize(img);
    expect(t.calls.create).toBe(1);                   // one worker for many pages
    await ocr.terminate();
    expect(t.calls.terminate).toBe(1);
  });

  it("fails at once when tesseract reports a load error, instead of waiting forever", async () => {
    const t = fakeTesseract("report");
    const ocr = createBrowserOcr({ loadTesseract: t.load, loadTimeoutMs: 10000 });
    const started = Date.now();
    await expect(ocr.recognize(img)).rejects.toThrow(/OCR engine error: Network error while fetching/);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("fails after the load timeout when tesseract never settles (offline, the library bug)", async () => {
    const t = fakeTesseract("hang");
    const ocr = createBrowserOcr({ loadTesseract: t.load, loadTimeoutMs: 50 });
    await expect(ocr.recognize(img)).rejects.toThrow(/could not be loaded/);
  });

  it("after a load failure, the next pages fail fast; after the cool-down it tries again", async () => {
    const t = fakeTesseract("hang");
    const ocr = createBrowserOcr({ loadTesseract: t.load, loadTimeoutMs: 30, retryAfterMs: 200 });
    await expect(ocr.recognize(img)).rejects.toThrow(/could not be loaded/);
    const started = Date.now();
    await expect(ocr.recognize(img)).rejects.toThrow(/could not be loaded/);
    expect(Date.now() - started).toBeLessThan(25);   // no second wait
    expect(t.calls.create).toBe(1);
    await new Promise((r) => setTimeout(r, 220));
    await expect(ocr.recognize(img)).rejects.toThrow(/could not be loaded/);
    expect(t.calls.create).toBe(2);                   // retried after the cool-down
    ocr.reset();                                      // a new user action retries at once, inside the cool-down
    await expect(ocr.recognize(img)).rejects.toThrow(/could not be loaded/);
    expect(t.calls.create).toBe(3);
  });

  it("a page that takes too long fails that page and the next page gets a fresh worker", async () => {
    let n = 0;
    const t = fakeTesseract("ok", { recognize: () => (++n === 1 ? new Promise(() => {}) : Promise.resolve({ data: okData })) });
    const ocr = createBrowserOcr({ loadTesseract: t.load, pageTimeoutMs: 40 });
    await expect(ocr.recognize(img)).rejects.toThrow(/took too long/);
    expect(t.calls.terminate).toBe(1);
    expect((await ocr.recognize(img)).text).toBe("Ștefan Hariton\n");
    expect(t.calls.create).toBe(2);
  });

  it("an error reported while recognising a page fails that page", async () => {
    let opts;
    const createWorker = (l, o, options) => { opts = options; return Promise.resolve({ recognize: () => { setTimeout(() => opts.errorHandler({ message: "bad image" }), 5); return new Promise(() => {}); }, terminate: async () => {} }); };
    const ocr = createBrowserOcr({ loadTesseract: async () => ({ default: { createWorker } }), pageTimeoutMs: 5000 });
    await expect(ocr.recognize(img)).rejects.toThrow(/OCR engine error: bad image/);
  });
});
