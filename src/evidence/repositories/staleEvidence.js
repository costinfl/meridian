/**
 * Evidence that was read from a copy which a newer copy has replaced (or from any copy): its pages, regions,
 * text layers, records and assertions. After "replace" the old evidence is kept, but it was produced from the
 * older (maybe poorer) file, so it should be re-checked against the new copy.
 */
export function createStaleEvidence(storage) {
  return {
    /** { copy, supersededByCopyId, pageIds, regionIds, textLayerIds, recordIds, assertionIds } */
    async staleEvidenceFor(copyId) {
      const copy = await storage.dbGet("evCopies", copyId);
      const out = { copy, supersededByCopyId: copy?.supersededByCopyId ?? null, pageIds: [], regionIds: [], textLayerIds: [], recordIds: [], assertionIds: [] };
      if (!copy) return out;
      await storage.dbTransact(["evPages", "evRegions", "evTextLayers", "evRecords", "evAssertions"], "readonly", async (o) => {
        const records = new Set(), assertions = new Set();
        for (const page of await o.getAllByIndex("evPages", "byCopy", copyId)) {
          out.pageIds.push(page.id);
          for (const region of await o.getAllByIndex("evRegions", "byPage", page.id)) {
            out.regionIds.push(region.id);
            for (const t of await o.getAllByIndex("evTextLayers", "byRegion", region.id)) out.textLayerIds.push(t.id);
            for (const r of await o.getAllByIndex("evRecords", "byRegion", region.id)) records.add(r.id);
            for (const a of await o.getAllByIndex("evAssertions", "byRegion", region.id)) assertions.add(a.id);
          }
        }
        out.recordIds = [...records]; out.assertionIds = [...assertions];
      });
      return out;
    },
  };
}
