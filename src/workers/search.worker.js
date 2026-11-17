// Search worker (Phase 7): builds, updates and queries the search index off the main thread.
// Messages: { id, op, args } -> { id, ok, result | error }. The worker opens the same IndexedDB database.
import { storage } from "../storage/StorageService.js";
import { createEvidenceLibrary } from "../evidence/index.js";
import { createSearchService, runOp } from "../search/service.js";

const service = createSearchService(createEvidenceLibrary(storage));
self.onmessage = async (e) => {
  const { id, op, args } = e.data ?? {};
  try { self.postMessage({ id, ok: true, result: await runOp(service, op, args) }); }
  catch (err) { self.postMessage({ id, ok: false, error: String(err?.message ?? err) }); }
};
