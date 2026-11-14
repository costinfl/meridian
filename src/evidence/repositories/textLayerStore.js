import { newId, nowIso } from "../ids.js";
import { EvidenceError, invalid, notFound, requireString } from "../domain/errors.js";
import { normalizedBox } from "../domain/box.js";
import { normalizeText } from "../domain/normalize.js";
import { applyCorrection, applyRewrite } from "../domain/reading.js";

const LAYERS = "evTextLayers";
/**
 * Two kinds of text layer live side by side on a region, each with its own supersede chain:
 *   transcription  what a processor read (pdf-text, docx-text, OCR, later HTR); the default, so older layers are this kind
 *   reading        the researcher's modern reading, with sourced corrections; written only by the user actions below
 */
export const TEXT_LAYER_KINDS = ["transcription", "reading"];
export const kindOf = (layer) => layer?.kind ?? "transcription";
const READING_PROCESSOR_VERSION = "text-review-1";

/** Pick the current layer of one kind among layers of ONE region: not superseded, newest first. */
export function pickCurrent(layers, kind = "transcription") {
  const own = layers.filter((l) => kindOf(l) === kind);
  const superseded = new Set(own.map((l) => l.supersedesId).filter(Boolean));
  const live = own.filter((l) => !superseded.has(l.id));
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

  /** Insert a layer, checking region, run and supersede rules inside the given transaction `o`. */
  async function insert(o, layer) {
    if (!(await o.get("evRegions", layer.regionId))) throw notFound("Region", layer.regionId);
    if (!(await o.get("evRuns", layer.runId))) throw notFound("ProcessingRun", layer.runId);
    if (layer.supersedesId) {
      const prev = await o.get(LAYERS, layer.supersedesId);
      if (!prev) throw notFound("TextLayer", layer.supersedesId);
      if (prev.regionId !== layer.regionId) throw invalid("a layer can only supersede a layer of the same region");
      if (kindOf(prev) !== kindOf(layer)) throw invalid("a reading and a transcription never supersede each other");
      const already = await o.getAllByIndex(LAYERS, "bySupersedes", layer.supersedesId);
      if (already.length) throw new EvidenceError("conflict", "that layer is already superseded");
    }
    await o.add(LAYERS, layer);
  }

  /** A finished `manual` run for one save of a reading (I3: every layer references its run). */
  const manualRun = (parameters) => {
    const at = nowIso();
    return { id: newId(), processor: "manual", processorVersion: READING_PROCESSOR_VERSION, modelId: "", parameters, schemaVersion: "", status: "succeeded", startedAt: at, finishedAt: at };
  };

  /** Next version of a reading: a new layer superseding `prev`, written with its own manual run. */
  async function saveReading(prev, text, annotations, parameters) {
    const run = manualRun(parameters);
    const layer = {
      id: newId(), kind: "reading", regionId: prev.regionId, runId: run.id,
      originalText: text, normalizedText: normalizeText(text),
      language: prev.language ?? "", script: prev.script ?? "", confidence: null, words: null,
      annotations, startedFromLayerId: prev.startedFromLayerId ?? null,
      supersedesId: prev.id, createdAt: nowIso(),
    };
    await storage.dbTransact([LAYERS, "evRegions", "evRuns"], "readwrite", async (o) => {
      await o.add("evRuns", run);
      await insert(o, layer);
    });
    return layer;
  }

  async function currentReading(readingId) {
    const prev = await storage.dbGet(LAYERS, requireString(readingId, "readingId"));
    if (!prev || kindOf(prev) !== "reading") throw notFound("Reading", readingId);
    if ((await storage.dbGetAllByIndex(LAYERS, "bySupersedes", prev.id)).length) {
      throw new EvidenceError("conflict", "this reading has a newer version; reload and try again");
    }
    return prev;
  }

  return {
    /** Add a transcription layer (what a processor read). Readings are created only through the user actions below. */
    async add(input = {}) {
      if (input.kind != null && input.kind !== "transcription") throw invalid("readings are created with startReading, correctReading or rewriteReading");
      const originalText = input.originalText;
      if (typeof originalText !== "string") throw invalid("originalText must be a string");
      if (input.confidence != null && !(typeof input.confidence === "number" && input.confidence >= 0 && input.confidence <= 1)) {
        throw invalid("confidence must be a number between 0 and 1");
      }
      const layer = {
        id: newId(),
        kind: "transcription",
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
      await storage.dbTransact([LAYERS, "evRegions", "evRuns"], "readwrite", (o) => insert(o, layer));
      return layer;
    },

    /**
     * USER ACTION: start the modern reading of a region, as a copy of its current transcription (empty if the region
     * has none, e.g. a handwritten page waiting for HTR). The transcription itself is never changed.
     */
    async startReading({ regionId } = {}) {
      requireString(regionId, "regionId");
      const all = await storage.dbGetAllByIndex(LAYERS, "byRegion", regionId);
      if (pickCurrent(all, "reading")) throw new EvidenceError("conflict", "this region already has a reading");
      const from = pickCurrent(all, "transcription");
      const run = manualRun({ action: "start", fromLayerId: from?.id ?? null });
      const text = from?.originalText ?? "";
      const layer = {
        id: newId(), kind: "reading", regionId, runId: run.id,
        originalText: text, normalizedText: normalizeText(text),
        language: from?.language ?? "", script: from?.script ?? "", confidence: null, words: null,
        annotations: [], startedFromLayerId: from?.id ?? null, supersedesId: null, createdAt: nowIso(),
      };
      await storage.dbTransact([LAYERS, "evRegions", "evRuns"], "readwrite", async (o) => {
        const again = await o.getAllByIndex(LAYERS, "byRegion", regionId);
        if (pickCurrent(again, "reading")) throw new EvidenceError("conflict", "this region already has a reading");
        await o.add("evRuns", run);
        await insert(o, layer);
      });
      return layer;
    },
    /**
     * USER ACTION: correct one fragment of the current reading, optionally citing a link where the right text is
     * known from. Saves a new version that supersedes the previous one; earlier annotations move with the text.
     */
    async correctReading({ readingId, start, end, after, url = "", note = "" } = {}) {
      const prev = await currentReading(readingId);
      const id = newId();
      const r = applyCorrection({ text: prev.originalText, annotations: prev.annotations ?? [], start, end, after, url, note, id, createdAt: nowIso() });
      return saveReading(prev, r.text, r.annotations, { action: "correct", annotationId: id });
    },
    /** USER ACTION: replace the whole reading text (free typing). Annotations on changed text are kept as replaced. */
    async rewriteReading({ readingId, text } = {}) {
      if (typeof text !== "string") throw invalid("text must be a string");
      const prev = await currentReading(readingId);
      const marker = newId();
      const r = applyRewrite({ text: prev.originalText, annotations: prev.annotations ?? [], newText: text, marker });
      if (!r.changed) return prev;
      return saveReading(prev, r.text, r.annotations, { action: "rewrite", marker });
    },
    get: (id) => storage.dbGet(LAYERS, id).then((r) => r ?? null),
    /** Full history for a region, oldest first; `kind` limits it to transcriptions or readings. */
    async listByRegion(regionId, kind = null) {
      const all = await storage.dbGetAllByIndex(LAYERS, "byRegion", regionId);
      return all.filter((l) => !kind || kindOf(l) === kind).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    },
    listByRun: (runId) => storage.dbGetAllByIndex(LAYERS, "byRun", runId),
    /** Current layer of a kind for a region: the newest one not superseded (several per region is normal). */
    async current(regionId, kind = "transcription") {
      return pickCurrent(await storage.dbGetAllByIndex(LAYERS, "byRegion", regionId), kind);
    },
    /** Current layer of a kind for every region of a page that has one: { [regionId]: layer }. */
    async currentForPage(pageId, kind = "transcription") {
      const out = {};
      await storage.dbTransact(["evRegions", LAYERS], "readonly", async (o) => {
        for (const region of await o.getAllByIndex("evRegions", "byPage", pageId)) {
          const cur = pickCurrent(await o.getAllByIndex(LAYERS, "byRegion", region.id), kind);
          if (cur) out[region.id] = cur;
        }
      });
      return out;
    },
  };
}
