import { newId, nowIso } from "../ids.js";
import { isSha256Hex, sha256Hex } from "../domain/hash.js";
import { invalid, notFound, pick, requireOneOf } from "../domain/errors.js";

const STORE = "evCopies";
export const STORAGE_MODES = ["blob", "folder"];
const EDITABLE = ["sourceId", "fileName", "mimeType", "pageCount", "accessedViaRepositoryId", "accessUrl", "accessedAt"];

/** `blob` -> { mode, blobKey } (kept in the blobs store); `folder` -> { mode, path } relative to the linked folder. */
function checkLocation(loc) {
  if (!loc || typeof loc !== "object") throw invalid("storage location is required");
  requireOneOf(loc.mode, STORAGE_MODES, "storage.mode");
  if (loc.mode === "blob") {
    if (!loc.blobKey) throw invalid("storage.blobKey is required for mode blob");
    return { mode: "blob", blobKey: loc.blobKey };
  }
  const path = String(loc.path ?? "");
  if (!path || path.startsWith("/") || /(^|[\\/])\.\.([\\/]|$)/.test(path)) throw invalid("storage.path must be a relative path inside the linked folder");
  return { mode: "folder", path };
}

/** One file held of a source. Identity = content SHA-256: registering the same bytes twice returns the first copy. */
export function createCopyStore(storage) {
  async function register(meta) {
    if (!isSha256Hex(meta.sha256)) throw invalid("sha256 must be 64 lowercase hex characters");
    const location = checkLocation(meta.storage);
    const now = nowIso();
    const rec = {
      id: newId(),
      sourceId: meta.sourceId ?? null, // null = unassigned (inbox) until linked to a source
      sha256: meta.sha256,
      mimeType: meta.mimeType ?? "",
      fileName: meta.fileName ?? "",
      pageCount: meta.pageCount ?? null,
      storage: location,
      accessedViaRepositoryId: meta.accessedViaRepositoryId ?? null,
      accessUrl: meta.accessUrl ?? "",
      accessedAt: meta.accessedAt ?? null,
      createdAt: now, updatedAt: now,
    };
    let outcome;
    await storage.dbTransact([STORE, "evSources", "evRepositories"], "readwrite", async (o) => {
      const existing = await o.getByIndex(STORE, "bySha256", rec.sha256);
      if (existing) { outcome = { copy: existing, created: false }; return; }
      if (rec.sourceId && !(await o.get("evSources", rec.sourceId))) throw notFound("Source", rec.sourceId);
      if (rec.accessedViaRepositoryId && !(await o.get("evRepositories", rec.accessedViaRepositoryId))) throw notFound("Repository", rec.accessedViaRepositoryId);
      await o.add(STORE, rec);
      outcome = { copy: rec, created: true };
    });
    return outcome;
  }

  return {
    register,
    /** Hash the bytes, then register. `data` is an ArrayBuffer, typed array or Blob. */
    async registerFile(data, meta = {}) {
      return register({ ...meta, sha256: await sha256Hex(data) });
    },
    get: (id) => storage.dbGet(STORE, id).then((r) => r ?? null),
    findBySha256: (sha256) => storage.dbGetByIndex(STORE, "bySha256", sha256).then((r) => r ?? null),
    listBySource: (sourceId) => storage.dbGetAllByIndex(STORE, "bySource", sourceId),
    async listUnassigned() {
      return (await storage.dbGetAll(STORE)).filter((c) => !c.sourceId);
    },
    /** The file moved or was renamed (found again by hash): keep the copy, update where it lives. */
    async relocate(id, location) {
      const cur = await storage.dbGet(STORE, id);
      if (!cur) throw notFound("DigitalCopy", id);
      const next = { ...cur, storage: checkLocation(location), updatedAt: nowIso() };
      await storage.dbPut(STORE, next);
      return next;
    },
    /** Descriptive metadata only; sha256 and mime of the bytes never change here except mimeType correction. */
    async update(id, patch) {
      let result;
      await storage.dbTransact([STORE, "evSources", "evRepositories"], "readwrite", async (o) => {
        const cur = await o.get(STORE, id);
        if (!cur) throw notFound("DigitalCopy", id);
        const next = { ...cur, ...pick(patch, EDITABLE), updatedAt: nowIso() };
        if (next.sourceId && !(await o.get("evSources", next.sourceId))) throw notFound("Source", next.sourceId);
        if (next.accessedViaRepositoryId && !(await o.get("evRepositories", next.accessedViaRepositoryId))) throw notFound("Repository", next.accessedViaRepositoryId);
        await o.put(STORE, next);
        result = next;
      });
      return result;
    },
  };
}
