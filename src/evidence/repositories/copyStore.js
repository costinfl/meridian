import { newId, nowIso } from "../ids.js";
import { isSha256Hex, sha256Hex } from "../domain/hash.js";
import { EvidenceError, invalid, notFound, pick, requireOneOf } from "../domain/errors.js";

const STORE = "evCopies";
export const STORAGE_MODES = ["blob", "folder"];
const EDITABLE = ["sourceId", "fileName", "label", "mimeType", "pageCount", "accessedViaRepositoryId", "accessUrl", "accessedAt", "pageLabelHint"];
export const DUPLICATE_ACTIONS = ["keep-both", "replace"];
const lc = (v) => String(v ?? "").trim().toLowerCase();

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

/**
 * One file held of a source. Identity = content SHA-256.
 *  - Byte-identical file again: nothing new is learned; the existing copy is returned, flagged `duplicate: identical`.
 *  - Same name/location but different bytes (another edition, a better scan): the new file is stored as its own
 *    copy and flagged `possible-version`; a person decides with `resolveDuplicate`:
 *      keep-both  both stay, the new one gets a distinguishing label;
 *      replace    the new copy takes over; the old one is kept (marked superseded) because evidence read from it
 *                 still cites it, and `staleEvidenceFor` lists that evidence for re-review. Bytes are never
 *                 overwritten in place: that would silently change what existing evidence refers to.
 */
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
      pageLabelHint: meta.pageLabelHint ?? "", // printed folio/page label of the first page, from a sidecar file
      label: meta.label ?? "", // distinguishes editions / scans of the same work ("1962 reprint", "better scan")
      possibleDuplicateOf: [], duplicateResolution: null, supersededByCopyId: null,
      createdAt: now, updatedAt: now,
    };
    let outcome;
    await storage.dbTransact([STORE, "evSources", "evRepositories"], "readwrite", async (o) => {
      const existing = await o.getByIndex(STORE, "bySha256", rec.sha256);
      if (existing) { outcome = { copy: existing, created: false, duplicate: { kind: "identical", of: [existing.id] } }; return; }
      if (rec.sourceId && !(await o.get("evSources", rec.sourceId))) throw notFound("Source", rec.sourceId);
      if (rec.accessedViaRepositoryId && !(await o.get("evRepositories", rec.accessedViaRepositoryId))) throw notFound("Repository", rec.accessedViaRepositoryId);
      // Same folder path, or same file name within the same source (or both unassigned), with different bytes.
      const similar = (await o.getAll(STORE)).filter((c) => !c.supersededByCopyId && (
        (rec.storage.mode === "folder" && c.storage.mode === "folder" && c.storage.path === rec.storage.path) ||
        (lc(rec.fileName) && lc(c.fileName) === lc(rec.fileName) && (c.sourceId ?? null) === (rec.sourceId ?? null))));
      if (similar.length) { rec.possibleDuplicateOf = similar.map((c) => c.id); rec.duplicateResolution = "pending"; }
      await o.add(STORE, rec);
      outcome = { copy: rec, created: true, duplicate: similar.length ? { kind: "possible-version", of: rec.possibleDuplicateOf } : null };
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
    /** Copies waiting for a keep-both / replace decision. */
    async listPendingDuplicates() {
      return (await storage.dbGetAll(STORE)).filter((c) => c.duplicateResolution === "pending");
    },
    /** Copies that are not superseded by a newer copy. */
    async listCurrent() {
      return (await storage.dbGetAll(STORE)).filter((c) => !c.supersededByCopyId);
    },
    /**
     * USER ACTION on a flagged copy. `keep-both`: both stay; the new copy gets `label` (default "<file name> (2)").
     * `replace`: the new copy supersedes `replacesCopyId` (one of the flagged candidates): the old copy is kept,
     * marked superseded, and evidence read from it is NOT rewritten (see staleEvidenceFor).
     */
    async resolveDuplicate(copyId, action, { label, replacesCopyId } = {}) {
      requireOneOf(action, DUPLICATE_ACTIONS, "action");
      let out;
      await storage.dbTransact([STORE], "readwrite", async (o) => {
        const cur = await o.get(STORE, copyId);
        if (!cur) throw notFound("DigitalCopy", copyId);
        if (cur.duplicateResolution !== "pending") throw new EvidenceError("conflict", "this copy has no pending duplicate decision");
        if (action === "keep-both") {
          const base = cur.fileName || "copy";
          out = { ...cur, label: String(label ?? "").trim() || `${base} (2)`, duplicateResolution: "kept-both", updatedAt: nowIso() };
          await o.put(STORE, out);
          return;
        }
        const targetId = replacesCopyId ?? (cur.possibleDuplicateOf.length === 1 ? cur.possibleDuplicateOf[0] : null);
        if (!targetId) throw invalid("replacesCopyId is required when several copies are flagged");
        if (!cur.possibleDuplicateOf.includes(targetId)) throw invalid("replacesCopyId must be one of the flagged copies");
        const old = await o.get(STORE, targetId);
        if (!old) throw notFound("DigitalCopy", targetId);
        if (old.supersededByCopyId) throw new EvidenceError("conflict", "that copy is already superseded");
        out = { ...cur, duplicateResolution: "replaced", sourceId: cur.sourceId ?? old.sourceId, label: label != null ? String(label) : cur.label, updatedAt: nowIso() };
        await o.put(STORE, out);
        await o.put(STORE, { ...old, supersededByCopyId: cur.id, updatedAt: nowIso() });
      });
      return out;
    },
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
