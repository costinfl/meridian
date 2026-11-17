import { createSearchService, runOp } from "../search/service.js";

// The page talks to search through this client: in a Web Worker when the browser has workers, otherwise in the
// page itself (tests, very old browsers). Same operations either way. If the worker cannot start or crashes,
// pending calls are re-run in the page and later calls stay there, so search never hangs.
export function createSearchClient({ library, useWorker = typeof Worker !== "undefined" && typeof window !== "undefined" && !import.meta.env?.VITEST, onFallback } = {}) {
  let local = null;
  const inPage = () => (local ??= createSearchService(library));
  if (!useWorker) return { call: (op, args) => runOp(inPage(), op, args), close() {}, get inWorker() { return false; } };

  let worker = null, failed = false, seq = 0;
  const waiting = new Map();
  const fallBack = (reason) => {
    if (failed) return;
    failed = true;
    try { worker?.terminate(); } catch { /* already gone */ }
    onFallback?.(reason);
    for (const [id, w] of waiting) { waiting.delete(id); runOp(inPage(), w.op, w.args).then(w.resolve, w.reject); }
  };
  try {
    worker = new Worker(new URL("./search.worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (e) => {
      const { id, ok, result, error } = e.data ?? {};
      const w = waiting.get(id);
      if (!w) return;
      waiting.delete(id);
      ok ? w.resolve(result) : w.reject(new Error(error));
    };
    worker.onerror = (e) => { e?.preventDefault?.(); fallBack(e?.message || "the search worker failed to start"); };
    worker.onmessageerror = () => fallBack("the search worker sent an unreadable message");
  } catch (e) {
    fallBack(String(e?.message ?? e));
  }
  return {
    call: (op, args) => {
      if (failed) return runOp(inPage(), op, args);
      return new Promise((resolve, reject) => { const id = ++seq; waiting.set(id, { resolve, reject, op, args }); worker.postMessage({ id, op, args }); });
    },
    close: () => { try { worker?.terminate(); } catch { /* ignore */ } },
    get inWorker() { return !failed; },
  };
}
