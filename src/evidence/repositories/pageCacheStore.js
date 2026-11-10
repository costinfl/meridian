import { nowIso } from "../ids.js";
import { invalid } from "../domain/errors.js";

const STORE = "evPageCache";

/**
 * Rendered page images. A DISPOSABLE cache: every entry can be regenerated from its DigitalCopy, so it may be
 * cleared at any time, is never exported, and nothing may depend on it existing. Images are kept as bytes.
 */
export function createPageCacheStore(storage) {
  const keyOf = (pageId, variant) => `${pageId}@${variant}`;
  return {
    async put({ pageId, variant = "default", bytes, mimeType = "image/png", width, height }) {
      if (!pageId) throw invalid("pageId is required");
      const u8 = ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : new Uint8Array(bytes);
      const rec = { key: keyOf(pageId, variant), pageId, variant, bytes: u8.slice().buffer, size: u8.byteLength, mimeType, width: width ?? null, height: height ?? null, createdAt: nowIso() };
      await storage.dbPut(STORE, rec);
      return { ...rec, bytes: new Uint8Array(rec.bytes) };
    },
    async get(pageId, variant = "default") {
      const r = await storage.dbGet(STORE, keyOf(pageId, variant));
      return r ? { ...r, bytes: new Uint8Array(r.bytes) } : null;
    },
    async stats() {
      const all = await storage.dbGetAll(STORE);
      return { entries: all.length, bytes: all.reduce((n, r) => n + (r.size ?? 0), 0) };
    },
    /** Remove every cached image (or those of one page). Returns how many were removed. */
    async clear(pageId = null) {
      return storage.dbTransact([STORE], "readwrite", async (o) => {
        const rows = pageId ? await o.getAllByIndex(STORE, "byPage", pageId) : await o.getAll(STORE);
        for (const r of rows) await o.delete(STORE, r.key);
        return rows.length;
      });
    },
  };
}
