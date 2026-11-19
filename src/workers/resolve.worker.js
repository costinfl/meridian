// Matching worker (Phase 9): profiles, blocking and comparison off the main thread. It reads the library from the
// same IndexedDB database; the project data comes with the message. Messages: { id, args } -> { id, ok, result | error }.
import { storage } from "../storage/StorageService.js";
import { createEvidenceLibrary } from "../evidence/index.js";
import { findMatches } from "../resolve/run.js";

const library = createEvidenceLibrary(storage);
self.onmessage = async (e) => {
  const { id, args } = e.data ?? {};
  try { self.postMessage({ id, ok: true, result: findMatches({ ...args, snapshot: await library.searchIndex.snapshot() }) }); }
  catch (err) { self.postMessage({ id, ok: false, error: String(err?.message ?? err) }); }
};
