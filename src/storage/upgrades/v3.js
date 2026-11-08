// Version 3: evidence library (Layers 1-2). Shared across projects (design principle 6).
// Indexes are listed next to each store; see docs/evidence-layer/evidence-model.md.
export const v3 = {
  version: 3,
  up(db) {
    const make = (name, keyPath, indexes = []) => {
      if (db.objectStoreNames.contains(name)) return;
      const store = db.createObjectStore(name, { keyPath });
      for (const [idx, path, opts] of indexes) store.createIndex(idx, path, opts ?? { unique: false });
    };
    make("evRepositories", "id");
    make("evSources", "id", [["byParent", "parentSourceId"], ["byRepository", "repositoryId"]]);
    make("evCopies", "id", [["bySha256", "sha256", { unique: true }], ["bySource", "sourceId"]]);
    make("evPages", "id", [["byCopy", "copyId"], ["byCopyIndex", ["copyId", "pageIndex"], { unique: true }]]);
    make("evRegions", "id", [["byPage", "pageId"], ["byParent", "parentRegionId"]]);
    make("evRuns", "id", [["byProcessor", "processor"], ["byStartedAt", "startedAt"]]);
    make("evRunItems", "id", [["byRun", "runId"], ["byPage", "pageId"]]);
    make("evRawOutputs", "id", [["bySha256", "sha256"]]);
    make("evTextLayers", "id", [["byRegion", "regionId"], ["byRun", "runId"], ["bySupersedes", "supersedesId"]]);
    make("evPageCache", "key", [["byPage", "pageId"]]); // disposable: always regenerable from the copy
  },
};
