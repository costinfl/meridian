// Search index and queries (Phase 7). Pure modules over the evidence library; they run in a worker or in the page.
export { buildDocuments, documentOf, prepare, variantMap } from "./documents.js";
export { createIndex, serialize, deserialize, INDEX_SCHEMA_VERSION, FIELDS } from "./engine.js";
export { buildIndex, saveIndex, loadIndex, rebuildIndex, updateIndex, changedRegions, markOf } from "./indexer.js";
export { createSearchService, runOp } from "./service.js";
