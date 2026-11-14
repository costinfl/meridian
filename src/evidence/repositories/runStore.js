import { newId, nowIso } from "../ids.js";
import { sha256Hex } from "../domain/hash.js";
import { EvidenceError, invalid, notFound, pick, requireOneOf } from "../domain/errors.js";

export const PROCESSORS = ["router", "pdf-text", "docx-text", "tesseract", "llm-extraction", "entity-resolution", "manual", "import"];
export const RUN_STATUSES = ["running", "succeeded", "partial", "failed", "cancelled"];
export const FINAL_RUN_STATUSES = RUN_STATUSES.filter((s) => s !== "running");
export const ITEM_STATUSES = ["queued", "running", "succeeded", "failed", "skipped", "awaiting-htr"];
const RUNS = "evRuns", ITEMS = "evRunItems", RAW = "evRawOutputs";

const bytesOf = (data) => {
  if (typeof data === "string") return new TextEncoder().encode(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (Object.prototype.toString.call(data) === "[object ArrayBuffer]") return new Uint8Array(data);
  throw invalid("raw output must be a string, ArrayBuffer or typed array");
};

/** One execution of a processor over a batch (one run per batch; re-running one page is a one-page batch). */
export function createRunStore(storage) {
  return {
    /** Configuration of a run is fixed at creation so results stay reproducible; only status/finishedAt change. */
    async startRun({ processor, processorVersion = "", modelId = "", parameters = {}, schemaVersion = "" } = {}) {
      const run = {
        id: newId(),
        processor: requireOneOf(processor, PROCESSORS, "processor"),
        processorVersion, modelId, parameters, schemaVersion,
        status: "running",
        startedAt: nowIso(),
        finishedAt: null,
      };
      await storage.dbAdd(RUNS, run);
      return run;
    },
    async finishRun(id, status) {
      requireOneOf(status, FINAL_RUN_STATUSES, "status");
      let out;
      await storage.dbTransact([RUNS], "readwrite", async (o) => {
        const cur = await o.get(RUNS, id);
        if (!cur) throw notFound("ProcessingRun", id);
        if (cur.status !== "running") throw new EvidenceError("conflict", `run already finished (${cur.status})`);
        out = { ...cur, status, finishedAt: nowIso() };
        await o.put(RUNS, out);
      });
      return out;
    },
    getRun: (id) => storage.dbGet(RUNS, id).then((r) => r ?? null),
    async listRuns() {
      return (await storage.dbGetAll(RUNS)).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
    },

    /** Outcome of a run for one page. `result` holds small structured output (e.g. the router's page classification). */
    async addItem({ runId, pageId, status = "queued", error = "", unitsBilled = 0, rawOutputId = null, result = null } = {}) {
      requireOneOf(status, ITEM_STATUSES, "status");
      const item = { id: newId(), runId, pageId, status, error, unitsBilled, rawOutputId, result, createdAt: nowIso(), updatedAt: null };
      item.updatedAt = item.createdAt;
      await storage.dbTransact([ITEMS, RUNS, "evPages", RAW], "readwrite", async (o) => {
        if (!(await o.get(RUNS, runId))) throw notFound("ProcessingRun", runId);
        if (!(await o.get("evPages", pageId))) throw notFound("Page", pageId);
        if (rawOutputId && !(await o.get(RAW, rawOutputId))) throw notFound("RawOutput", rawOutputId);
        await o.add(ITEMS, item);
      });
      return item;
    },
    async updateItem(id, patch) {
      let out;
      await storage.dbTransact([ITEMS, RAW], "readwrite", async (o) => {
        const cur = await o.get(ITEMS, id);
        if (!cur) throw notFound("ProcessingRunItem", id);
        const next = { ...cur, ...pick(patch, ["status", "error", "unitsBilled", "rawOutputId", "result"]), updatedAt: nowIso() };
        requireOneOf(next.status, ITEM_STATUSES, "status");
        if (next.rawOutputId && !(await o.get(RAW, next.rawOutputId))) throw notFound("RawOutput", next.rawOutputId);
        await o.put(ITEMS, next);
        out = next;
      });
      return out;
    },
    getItem: (id) => storage.dbGet(ITEMS, id).then((r) => r ?? null),
    /** Items of a run in the order they were added. */
    listItems: async (runId) => (await storage.dbGetAllByIndex(ITEMS, "byRun", runId)).sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)),
    itemsForPage: (pageId) => storage.dbGetAllByIndex(ITEMS, "byPage", pageId),

    /** Raw processor output, kept verbatim (insert-only). Returns the metadata row; use getRawOutput for the bytes. */
    async addRawOutput({ data, mediaType = "application/octet-stream", schemaVersion = "" } = {}) {
      const u8 = bytesOf(data);
      const copy = u8.slice().buffer; // detached from the caller's buffer
      const rec = { id: newId(), mediaType, schemaVersion, sha256: await sha256Hex(u8), size: u8.byteLength, bytes: copy, createdAt: nowIso() };
      await storage.dbAdd(RAW, rec);
      const { bytes, ...meta } = rec;
      return meta;
    },
    /** { id, mediaType, schemaVersion, sha256, size, bytes: Uint8Array } or null. */
    async getRawOutput(id) {
      const r = await storage.dbGet(RAW, id);
      return r ? { ...r, bytes: new Uint8Array(r.bytes) } : null;
    },
  };
}
