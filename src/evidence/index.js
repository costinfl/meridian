// Evidence layer (Layers 1-3, places, names, dates). Layers 1-2 implemented in Phase 2.
// Rule I5: nothing under src/evidence may import conclusions, UI, hooks or models.
import { createRepositoryStore } from "./repositories/repositoryStore.js";
import { createSourceStore } from "./repositories/sourceStore.js";
import { createCopyStore } from "./repositories/copyStore.js";
import { createPageStore } from "./repositories/pageStore.js";
import { createRunStore } from "./repositories/runStore.js";
import { createTextLayerStore } from "./repositories/textLayerStore.js";
import { createPlaceStore } from "./repositories/placeStore.js";
import { createRecordStore } from "./repositories/recordStore.js";
import { createNameVariantStore } from "./repositories/nameVariantStore.js";

export { EvidenceError } from "./domain/errors.js";
export { normalizedBox, boxFromPixels, WHOLE_PAGE_BOX } from "./domain/box.js";
export { sha256Hex } from "./domain/hash.js";
export { SOURCE_KINDS } from "./repositories/sourceStore.js";
export { REPOSITORY_KINDS } from "./repositories/repositoryStore.js";
export { PROCESSORS } from "./repositories/runStore.js";
export { RECORD_KINDS, ROLES } from "./repositories/recordStore.js";
export { fuzzyDate, fuzzyDateFromIso, fromStatedAge, overlaps } from "./domain/fuzzyDate.js";
export { normalizeText, searchKey, dmCodesOfName } from "./domain/normalize.js";

/** The evidence library bound to a storage service (StorageService or an IndexedDBAdapter). */
export function createEvidenceLibrary(storage) {
  return {
    repositories: createRepositoryStore(storage),
    sources: createSourceStore(storage),
    copies: createCopyStore(storage),
    pages: createPageStore(storage),
    runs: createRunStore(storage),
    textLayers: createTextLayerStore(storage),
    places: createPlaceStore(storage),
    records: createRecordStore(storage),
    nameVariants: createNameVariantStore(storage),
  };
}
