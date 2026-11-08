// Version 4: places, names, records, personas, assertions (Layer 3 + places/names/dates).
// Indexes mirror the query needs in docs/evidence-layer/evidence-model.md. Day-number fields are
// Julian Day Numbers (see evidence/domain/fuzzyDate.js); `citationRegionId` is the flattened
// assertion citation so it can be indexed.
export const v4 = {
  version: 4,
  up(db) {
    const make = (name, keyPath, indexes = []) => {
      if (db.objectStoreNames.contains(name)) return;
      const store = db.createObjectStore(name, { keyPath });
      for (const [idx, path, opts] of indexes) store.createIndex(idx, path, opts ?? { unique: false });
    };
    make("evPlaces", "id", [["byKind", "kind"]]);
    make("evPlaceNames", "id", [["byPlace", "placeId"], ["byName", "name"], ["byNameKey", "nameKey"]]);
    make("evPlaceParents", "id", [["byChild", "childId"], ["byParent", "parentId"]]);
    make("evNameVariants", "id", [["byCanonicalKey", "canonicalKey"], ["byVariantKey", "variantKey"]]);
    make("evRecords", "id", [
      ["byKind", "kind"], ["byPlace", "placeId"], ["byRun", "runId"],
      ["byRegion", "regionIds", { unique: false, multiEntry: true }],
      ["byEarliestDay", "eventEarliestDay"], ["byLatestDay", "eventLatestDay"],
    ]);
    make("evPersonas", "id", [["byRecord", "recordId"], ["byNameKey", "nameKey"], ["bySurnameDm", "surnameDm", { unique: false, multiEntry: true }]]);
    make("evAssertions", "id", [
      ["bySubject", "subjectId"], ["byObject", "objectPersonaId"], ["byRegion", "citationRegionId"],
      ["byStatus", "status"], ["byRun", "runId"], ["bySupersedes", "supersedesId"],
      ["bySubjectProperty", ["subjectId", "property"]], ["byRegionProperty", ["citationRegionId", "property"]],
    ]);
  },
};
