import { newId, nowIso } from "../ids.js";
import { EvidenceError, invalid, notFound, pick, requireOneOf, requireString } from "../domain/errors.js";

export const SOURCE_KINDS = [
  "parish-register", "civil-register", "census", "newspaper-title", "newspaper-issue",
  "book", "archival-document", "image", "web", "other",
];
const STORE = "evSources";
const EDITABLE = [
  "kind", "title", "issuingAuthority", "placeText", "dateRange", "languages", "script",
  "repositoryId", "callNumber", "parentSourceId", "citation",
];

const blankCall = { fond: "", inventory: "", file: "" };

/** The original work: register volume, newspaper issue, book, census... (not a file: see copies). */
export function createSourceStore(storage) {
  async function check(o, rec, selfId) {
    requireOneOf(rec.kind, SOURCE_KINDS, "kind");
    requireString(rec.title, "title");
    if (!Array.isArray(rec.languages)) throw invalid("languages must be an array");
    if (rec.dateRange && (typeof rec.dateRange !== "object" || (rec.dateRange.from && rec.dateRange.to && rec.dateRange.from > rec.dateRange.to))) {
      throw invalid("dateRange must be { from, to } with from <= to");
    }
    if (rec.repositoryId && !(await o.get("evRepositories", rec.repositoryId))) throw notFound("Repository", rec.repositoryId);
    if (rec.parentSourceId) {
      // parent must exist and the hierarchy must stay acyclic
      let cursor = rec.parentSourceId;
      const seen = new Set();
      while (cursor) {
        if (cursor === selfId) throw new EvidenceError("invariant", "source hierarchy would contain a cycle");
        if (seen.has(cursor)) break;
        seen.add(cursor);
        const p = await o.get(STORE, cursor);
        if (!p) throw notFound("Parent source", cursor);
        cursor = p.parentSourceId;
      }
    }
  }

  return {
    async create(input = {}) {
      const now = nowIso();
      const rec = {
        id: newId(),
        kind: input.kind ?? "other",
        title: input.title,
        issuingAuthority: input.issuingAuthority ?? "",
        placeText: input.placeText ?? "", // free text until places exist (Phase 3)
        dateRange: input.dateRange ?? null,
        languages: input.languages ?? [],
        script: input.script ?? "",
        repositoryId: input.repositoryId ?? null,
        callNumber: { ...blankCall, ...(input.callNumber ?? {}) },
        parentSourceId: input.parentSourceId ?? null,
        citation: input.citation ?? "",
        createdAt: now, updatedAt: now,
      };
      if (typeof rec.title === "string") rec.title = rec.title.trim();
      await storage.dbTransact([STORE, "evRepositories"], "readwrite", async (o) => {
        await check(o, rec, rec.id);
        await o.add(STORE, rec);
      });
      return rec;
    },
    get: (id) => storage.dbGet(STORE, id).then((r) => r ?? null),
    async list() {
      return (await storage.dbGetAll(STORE)).sort((a, b) => a.title.localeCompare(b.title));
    },
    children: (parentId) => storage.dbGetAllByIndex(STORE, "byParent", parentId),
    /** Parent chain, nearest first. */
    async ancestors(id) {
      const out = [];
      let cur = await storage.dbGet(STORE, id);
      while (cur?.parentSourceId) {
        cur = await storage.dbGet(STORE, cur.parentSourceId);
        if (!cur || out.some((x) => x.id === cur.id)) break;
        out.push(cur);
      }
      return out;
    },
    /** Descriptive metadata of the work may be corrected (it is not evidence content). */
    async update(id, patch) {
      let result;
      await storage.dbTransact([STORE, "evRepositories"], "readwrite", async (o) => {
        const cur = await o.get(STORE, id);
        if (!cur) throw notFound("Source", id);
        const next = { ...cur, ...pick(patch, EDITABLE), updatedAt: nowIso() };
        if (patch && "callNumber" in patch) next.callNumber = { ...blankCall, ...(patch.callNumber ?? {}) };
        if (typeof next.title === "string") next.title = next.title.trim();
        await check(o, next, id);
        await o.put(STORE, next);
        result = next;
      });
      return result;
    },
  };
}
