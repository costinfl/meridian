import { VERSIONS } from "./versions.js";

// OCR in the browser with tesseract.js. The library, its WebAssembly core and the language data are all served
// by this site under <base>/ocr/ (copied from node_modules at build time, see vite.config.js) and are loaded only
// when the first page is sent to OCR. tesseract.js does the recognition in its own worker thread.
// Only Romanian ("ron") language data is shipped; other languages would need their data added to the build.
//
// Failure handling: tesseract.js 7 never settles createWorker() when the language data cannot be loaded (its
// internal chain ends in `.catch(() => {})`), so the browser would wait forever, e.g. offline. We pass an
// `errorHandler` to learn about the failure at once, race every step against it and a timeout, and after a load
// failure we fail fast for `retryAfterMs` so a batch does not wait on every page.

const assetBase = () => `${import.meta.env?.BASE_URL ?? "/"}ocr/`;

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([promise, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(message)), ms); })]).finally(() => clearTimeout(timer));
}

/**
 * @param {object} [o]
 * @param {string[]} [o.languages]
 * @param {(m: object) => void} [o.onStatus]         tesseract progress messages
 * @param {number} [o.loadTimeoutMs]                  loading the engine and language data
 * @param {number} [o.pageTimeoutMs]                  recognising one page
 * @param {number} [o.retryAfterMs]                   after a load failure, fail at once for this long
 * @param {() => Promise<object>} [o.loadTesseract]  for tests
 */
export function createBrowserOcr({
  languages = ["ron"], onStatus, loadTimeoutMs = 60000, pageTimeoutMs = 180000, retryAfterMs = 30000,
  loadTesseract = () => import("tesseract.js"),
} = {}) {
  let workerPromise = null;
  let failure = null;               // { error, at } after a failed load
  let rejectFatal = null;           // rejects the current wait when tesseract reports an error

  const fatal = () => new Promise((_, rej) => { rejectFatal = rej; });
  const errorHandler = (data) => {
    const err = new Error(`OCR engine error: ${typeof data === "string" ? data : data?.message ?? JSON.stringify(data)}`);
    rejectFatal?.(err);
  };

  const getWorker = () => {
    if (failure && Date.now() - failure.at < retryAfterMs) return Promise.reject(failure.error);
    if (!workerPromise) {
      workerPromise = (async () => {
        const mod = await loadTesseract();
        const Tesseract = mod.default ?? mod;
        const creating = Tesseract.createWorker(languages, 1, {
          workerPath: `${assetBase()}worker.min.js`, corePath: `${assetBase()}core`, langPath: `${assetBase()}lang`, gzip: true,
          logger: (m) => onStatus?.(m), errorHandler,
        });
        return withTimeout(Promise.race([creating, fatal()]), loadTimeoutMs, "The OCR engine or its Romanian language data could not be loaded (are you offline?)");
      })();
      workerPromise.then(() => { failure = null; }, (error) => { failure = { error, at: Date.now() }; workerPromise = null; });
    }
    return workerPromise;
  };

  return {
    languages,
    version: VERSIONS.tesseractJs,
    model: VERSIONS.ronTraineddata,
    /** @returns {{ text, confidence, words: [{ text, bbox: {x0,y0,x1,y1}, confidence }], raw, rawMediaType }} boxes in image pixels */
    async recognize({ bytes, mimeType }) {
      const worker = await getWorker();
      let data;
      try {
        ({ data } = await withTimeout(Promise.race([worker.recognize(new Blob([bytes], { type: mimeType }), {}, { blocks: true }), fatal()]), pageTimeoutMs, "OCR took too long on this page"));
      } catch (e) {
        // the worker may be stuck: start a fresh one next time
        workerPromise = null;
        worker.terminate?.().catch?.(() => {});
        throw e;
      }
      const words = [];
      for (const block of data.blocks ?? []) for (const par of block.paragraphs ?? []) for (const line of par.lines ?? []) for (const w of line.words ?? []) {
        words.push({ text: w.text, bbox: { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 }, confidence: w.confidence });
      }
      const raw = JSON.stringify({ engine: "tesseract.js", version: VERSIONS.tesseractJs, languages, text: data.text, confidence: data.confidence, words });
      return { text: data.text, confidence: data.confidence, words, raw, rawMediaType: "application/json" };
    },
    /** Forget a recent load failure, so the next page tries again (call at the start of each user action). */
    reset() { failure = null; },
    async terminate() {
      if (!workerPromise) return;
      const w = await workerPromise.catch(() => null);
      workerPromise = null;
      await w?.terminate();
    },
  };
}
