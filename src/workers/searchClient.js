import { createSearchService, runOp } from "../search/service.js";

// The page talks to search through this client: in a Web Worker when the browser has workers, otherwise in the
// page itself (tests, very old browsers). Same operations either way.
export function createSearchClient({ library, useWorker = typeof Worker !== "undefined" && typeof window !== "undefined" && !import.meta.env?.VITEST } = {}) {
  if (!useWorker) {
    const service = createSearchService(library);
    return { call: (op, args) => runOp(service, op, args), close() {}, inWorker: false };
  }
  const worker = new Worker(new URL("./search.worker.js", import.meta.url), { type: "module" });
  let seq = 0;
  const waiting = new Map();
  worker.onmessage = (e) => {
    const { id, ok, result, error } = e.data;
    const w = waiting.get(id);
    if (!w) return;
    waiting.delete(id);
    ok ? w.resolve(result) : w.reject(new Error(error));
  };
  return {
    call: (op, args) => new Promise((resolve, reject) => { const id = ++seq; waiting.set(id, { resolve, reject }); worker.postMessage({ id, op, args }); }),
    close: () => worker.terminate(),
    inWorker: true,
  };
}
