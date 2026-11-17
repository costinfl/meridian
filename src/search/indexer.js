import { buildDocuments } from "./documents.js";
import { createIndex, serialize, deserialize, INDEX_SCHEMA_VERSION } from "./engine.js";

// Building, storing and loading the search index (P7.T1). The stored row (evSearchIndex, IndexedDB v6) is derived
// data: a full rebuild from the library always gives the same index (I7).

const placeAncestorsOf = (library) => (placeId, when) => library.places.ancestorsAt(placeId, when ?? null).catch(() => []);
const nowIso = () => new Date().toISOString();

/** Full rebuild from the stores. Returns { index, docCount, builtAt }. */
export async function buildIndex(library) {
  const builtAt = nowIso();
  const docs = await buildDocuments(await library.searchIndex.snapshot(), { placeAncestors: placeAncestorsOf(library) });
  const index = createIndex();
  index.addAll(docs);
  return { index, docCount: docs.length, builtAt };
}

export async function saveIndex(library, { index, builtAt }) {
  await library.searchIndex.put({ schemaVersion: INDEX_SCHEMA_VERSION, builtAt, docCount: index.documentCount, json: serialize(index) });
}

/** The stored index, or null if there is none or it was made by an older index schema. */
export async function loadIndex(library) {
  const row = await library.searchIndex.get();
  if (!row || row.schemaVersion !== INDEX_SCHEMA_VERSION) return null;
  return { index: deserialize(row.json), docCount: row.docCount, builtAt: row.builtAt };
}

/** Rebuild and store. */
export async function rebuildIndex(library) {
  const built = await buildIndex(library);
  await saveIndex(library, built);
  return built;
}
