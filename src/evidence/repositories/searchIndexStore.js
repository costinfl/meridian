// The serialised search index (`evSearchIndex`, IndexedDB v6) and the reads the indexer needs.
// Derived data only (I7): the row can be replaced or deleted at any time and rebuilt from the other stores.

const STORE = "evSearchIndex";
const SNAPSHOT_STORES = ["evSources", "evCopies", "evPages", "evRegions", "evTextLayers", "evRecords", "evPersonas", "evAssertions", "evAssertionDecisions", "evNameVariants"];
const KEYS = ["sources", "copies", "pages", "regions", "textLayers", "records", "personas", "assertions", "decisions", "nameVariants"];

export function createSearchIndexStore(storage) {
  return {
    get: (id = "main") => storage.dbGet(STORE, id).then((r) => r ?? null),
    /** Replace the stored index (derived data, so a plain put is fine). */
    put: (row) => storage.dbPut(STORE, { id: "main", ...row }),
    /** Forget the stored index (it is rebuilt on the next search). */
    remove: (id = "main") => storage.dbTransact([STORE], "readwrite", (o) => o.delete(STORE, id)),
    /** Everything the indexer reads, in one read transaction: { sources, copies, pages, regions, textLayers, records, personas, assertions, decisions, nameVariants }. */
    async snapshot() {
      const out = {};
      await storage.dbTransact(SNAPSHOT_STORES, "readonly", async (o) => {
        const rows = await Promise.all(SNAPSHOT_STORES.map((s) => o.getAll(s)));
        KEYS.forEach((k, i) => { out[k] = rows[i]; });
      });
      return out;
    },
  };
}
