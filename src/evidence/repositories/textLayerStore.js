import { newId, nowIso } from "../ids.js";
import { EvidenceError, invalid, notFound, requireString } from "../domain/errors.js";
import { normalizedBox } from "../domain/box.js";

const LAYERS = "evTextLayers";

/** Pick the current layer among layers of ONE region: not superseded, newest first. */
export function pickCurrent(layers) {
  const superseded = new Set(layers.map((l) => l.supersedesId).filter(Boolean));
  const live = layers.filter((l) => !superseded.has(l.id));
  live.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return live[0] ?? null;
}

/**
 * Text of a page or region from one run (whole-page text sits on the page's whole-page region).
 * Invariant I1: append-only. This store has no update or delete; a correction is a new layer with
 * `supersedesId`. Invariant I3: every layer references the run that produced it.
 */
export function createTextLayerStore(storage) {
  function checkWords(words) {
    if (words == null) return null;
    if (!Array.isArray(words)) throw invalid("words must be an array of { text, box }");
    return words.map((w, i) => {
      if (!w || typeof w.text !== "string") throw invalid(`words[${i}].text must be a string`);
      return { text: w.text, box: normalizedBox(w.box) }; // I4 applies to word boxes too
    });
  }

  return {
    async add(input = {}) {
      const originalText = input.originalText;
      if (typeof originalText !== "string") throw invalid("originalText must be a string");
      if (input.confidence != null && !(typeof input.confidence === "number" && input.confidence >= 0 && input.confidence <= 1)) {
        throw invalid("confidence must be a number between 0 and 1");
      }
      const layer = {
        id: newId(),
        regionId: requireString(input.regionId, "regionId"),
        runId: requireString(input.runId, "runId"), // I3
        originalText,
        // Until the normalisation module exists (Phase 3, P3.T4) the default is the original text.
        normalizedText: typeof input.normalizedText === "string" ? input.normalizedText : originalText,
        language: input.language ?? "",
        script: input.script ?? "",
        confidence: input.confidence ?? null,
        words: checkWords(input.words),
        supersedesId: input.supersedesId ?? null,
        createdAt: nowIso(),
      };
      await storage.dbTransact([LAYERS, "evRegions", "evRuns"], "readwrite", async (o) => {
        if (!(await o.get("evRegions", layer.regionId))) throw notFound("Region", layer.regionId);
        if (!(await o.get("evRuns", layer.runId))) throw notFound("ProcessingRun", layer.runId);
        if (layer.supersedesId) {
          const prev = await o.get(LAYERS, layer.supersedesId);
          if (!prev) throw notFound("TextLayer", layer.supersedesId);
          if (prev.regionId !== layer.regionId) throw invalid("a layer can only supersede a layer of the same region");
          const already = await o.getAllByIndex(LAYERS, "bySupersedes", layer.supersedesId);
          if (already.length) throw new EvidenceError("conflict", "that layer is already superseded");
        }
        await o.add(LAYERS, layer);
      });
      return layer;
    },
    get: (id) => storage.dbGet(LAYERS, id).then((r) => r ?? null),
    /** Full history for a region, oldest first. */
    async listByRegion(regionId) {
      return (await storage.dbGetAllByIndex(LAYERS, "byRegion", regionId)).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    },
    listByRun: (runId) => storage.dbGetAllByIndex(LAYERS, "byRun", runId),
    /** Current text layer of a region: the newest layer that is not superseded (several per region is normal). */
    async current(regionId) {
      return pickCurrent(await storage.dbGetAllByIndex(LAYERS, "byRegion", regionId));
    },
    /** Current layer for every region of a page that has text: { [regionId]: layer }. */
    async currentForPage(pageId) {
      const out = {};
      await storage.dbTransact(["evRegions", LAYERS], "readonly", async (o) => {
        for (const region of await o.getAllByIndex("evRegions", "byPage", pageId)) {
          const cur = pickCurrent(await o.getAllByIndex(LAYERS, "byRegion", region.id));
          if (cur) out[region.id] = cur;
        }
      });
      return out;
    },
  };
}
