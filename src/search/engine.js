import MiniSearch from "minisearch";
import { searchKey } from "../evidence/index.js";

// The full-text engine (MiniSearch). Documents come from documents.js; terms are folded with the same searchKey
// as the documents (diacritics, cedilla/comma-below, case), so "Stefan", "Ştefan" and "Ștefan" are one term.

export const INDEX_SCHEMA_VERSION = 1;
export const FIELDS = ["text", "names", "variants", "dm"];
export const STORE_FIELDS = [
  "pageId", "regionKind", "regionLabel", "box", "pageIndex", "pageLabel", "copyId", "fileName",
  "sourceId", "sourceTitle", "sourceKind", "earliestDay", "latestDay", "placeIds",
  "hasConfirmed", "hasProposed", "shownNames", "snippetSource",
];
export const OPTIONS = {
  fields: FIELDS,
  storeFields: STORE_FIELDS,
  processTerm: (term) => searchKey(term) || null,
  searchOptions: { boost: { names: 3, variants: 2, dm: 1, text: 1 } },
};

export const createIndex = () => new MiniSearch(OPTIONS);
export const serialize = (index) => JSON.stringify(index);
export const deserialize = (json) => MiniSearch.loadJSON(json, OPTIONS);
