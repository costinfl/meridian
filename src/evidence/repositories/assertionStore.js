import { newId, nowIso } from "../ids.js";
import { EvidenceError, invalid, notFound, requireOneOf, requireString } from "../domain/errors.js";
import { validateFuzzyDate } from "../domain/fuzzyDate.js";
import { normalizeText } from "../domain/normalize.js";

export const STATUSES = ["proposed", "confirmed", "rejected"];
// Value properties describe a record or persona; relation properties link two personas of one record.
export const VALUE_PROPERTIES = [
  "name", "sex", "role", "age", "occupation", "residence", "houseNumber",
  "birth.date", "birth.place", "death.date", "death.place", "event.date", "event.place",
];
export const RELATION_PROPERTIES = ["childOf", "parentOf", "spouseOf", "godparentOf", "witnessFor", "informantFor"];
const DATE_PROPERTIES = new Set(["birth.date", "death.date", "event.date"]);
const AGE_UNITS = ["years", "months", "days"];
const STORE = "evAssertions";
const NO_REGION_AGENTS = ["manual", "import"]; // I2 exceptions

const isExtension = (p) => typeof p === "string" && /^x-[a-z0-9.-]+$/.test(p);

/**
 * Atomic claims about a record or persona. Source of truth for everything the conclusions layer uses.
 *  I1  content is append-only: this store never rewrites content fields; a correction is a new
 *      assertion with `supersedesId`. Only the workflow fields (status, decidedBy, decidedAt) change,
 *      and only once, from `proposed`.
 *  I2  a citation region is mandatory, except agent `manual` (source + page label) and `import` (source).
 *  I3  every assertion references the run that produced it; `agent` is that run's processor.
 *  I6  nothing is `confirmed` or `rejected` without an explicit user action: `propose` can only create
 *      proposals; `confirmAssertion`, `rejectAssertion` and `enterAsUser` are the user-action entry points
 *      (the architecture test keeps automated modules from calling them).
 */
export function createAssertionStore(storage) {
  async function build(o, input, status, decision) {
    const runId = requireString(input.runId, "runId");
    const run = await o.get("evRuns", runId);
    if (!run) throw notFound("ProcessingRun", runId);

    const property = requireString(input.property, "property");
    const isRelation = RELATION_PROPERTIES.includes(property);
    if (!isRelation && !VALUE_PROPERTIES.includes(property) && !isExtension(property)) {
      throw invalid(`unknown property '${property}' (use one of the known properties or an 'x-' extension)`);
    }

    // subject
    const subjectType = requireOneOf(input.subjectType, ["record", "persona"], "subjectType");
    const subject = await o.get(subjectType === "record" ? "evRecords" : "evPersonas", requireString(input.subjectId, "subjectId"));
    if (!subject) throw notFound(subjectType === "record" ? "Record" : "Persona", input.subjectId);

    // relation object
    let objectPersonaId = input.objectPersonaId ?? null;
    if (isRelation || objectPersonaId) {
      if (!isRelation) throw invalid(`'${property}' is not a relation; objectPersonaId is not allowed`);
      if (subjectType !== "persona") throw invalid("a relation's subject must be a persona");
      const obj = objectPersonaId && (await o.get("evPersonas", objectPersonaId));
      if (!obj) throw objectPersonaId ? notFound("Persona", objectPersonaId) : invalid(`'${property}' requires objectPersonaId`);
      if (obj.recordId !== subject.recordId) throw invalid("both personas of a relation must belong to the same record");
      if (obj.id === subject.id) throw invalid("a persona cannot be related to itself");
    }

    // values
    if (typeof input.originalValue !== "string") throw invalid("originalValue must be a string (as written)");
    let normalizedValue = input.normalizedValue;
    if (normalizedValue === undefined) {
      if (DATE_PROPERTIES.has(property)) throw invalid(`${property} needs a normalizedValue (a FuzzyDate)`);
      if (property === "age") throw invalid("age needs a normalizedValue { value, unit, slack? }");
      normalizedValue = isRelation ? "" : normalizeText(input.originalValue);
    }
    if (DATE_PROPERTIES.has(property)) validateFuzzyDate(normalizedValue);
    if (property === "age") {
      const a = normalizedValue;
      if (!a || typeof a !== "object" || !Number.isInteger(a.value) || a.value < 0 || !AGE_UNITS.includes(a.unit ?? "years")) {
        throw invalid("age needs a normalizedValue { value, unit: years|months|days, slack? }");
      }
      normalizedValue = { value: a.value, unit: a.unit ?? "years", slack: a.slack ?? 0 };
    }
    if (input.confidence != null && !(typeof input.confidence === "number" && input.confidence >= 0 && input.confidence <= 1)) {
      throw invalid("confidence must be a number between 0 and 1");
    }

    // I2: citation
    const agent = run.processor;
    const citation = { regionId: input.citation?.regionId ?? null, sourceId: input.citation?.sourceId ?? null, pageLabel: input.citation?.pageLabel ?? "" };
    if (citation.regionId) {
      if (!(await o.get("evRegions", citation.regionId))) throw notFound("Region", citation.regionId);
    } else if (NO_REGION_AGENTS.includes(agent)) {
      if (!citation.sourceId) throw invalid(`a ${agent} assertion without a region must cite a source`);
      if (agent === "manual" && !String(citation.pageLabel).trim()) throw invalid("a manual assertion without a region must cite a page label");
    } else {
      throw invalid(`an assertion from ${agent} must cite a region (I2)`);
    }
    if (citation.sourceId && !(await o.get("evSources", citation.sourceId))) throw notFound("Source", citation.sourceId);

    // supersession
    const supersedesId = input.supersedesId ?? null;
    if (supersedesId) {
      const prev = await o.get(STORE, supersedesId);
      if (!prev) throw notFound("Assertion", supersedesId);
      if (prev.subjectId !== subject.id || prev.property !== property) throw invalid("a correction must concern the same subject and property");
      if ((await o.getAllByIndex(STORE, "bySupersedes", supersedesId)).length) throw new EvidenceError("conflict", "that assertion is already superseded");
      // I6: a confirmed assertion is the user's decision; only another user action may replace it
      if (prev.status === "confirmed" && status !== "confirmed") throw new EvidenceError("invariant", "a confirmed assertion can only be superseded by a user action");
    }

    return {
      id: newId(),
      subjectType, subjectId: subject.id, property,
      originalValue: input.originalValue, normalizedValue,
      objectPersonaId,
      citation, citationRegionId: citation.regionId,
      agent, runId,
      confidence: input.confidence ?? null,
      status,
      decidedBy: decision?.decidedBy ?? null, decidedAt: decision ? nowIso() : null,
      supersedesId,
      createdAt: nowIso(),
    };
  }
  const STORES = [STORE, "evRuns", "evRecords", "evPersonas", "evRegions", "evSources"];

  async function insert(input, status, decision) {
    let rec;
    await storage.dbTransact(STORES, "readwrite", async (o) => {
      rec = await build(o, input, status, decision);
      if (decision?.requireManual && rec.agent !== "manual") throw new EvidenceError("invariant", "enterAsUser requires a run whose processor is 'manual'");
      await o.add(STORE, rec);
    });
    return rec;
  }

  async function decide(id, status, decidedBy) {
    requireOneOf(status, ["confirmed", "rejected"], "status");
    const who = requireString(decidedBy, "decidedBy");
    let out;
    await storage.dbTransact([STORE], "readwrite", async (o) => {
      const cur = await o.get(STORE, id);
      if (!cur) throw notFound("Assertion", id);
      if (cur.status !== "proposed") throw new EvidenceError("conflict", `assertion is already ${cur.status}; make a correction instead`);
      out = { ...cur, status, decidedBy: who, decidedAt: nowIso() }; // content fields are carried over untouched
      await o.put(STORE, out);
    });
    return out;
  }

  return {
    /** Any agent may propose. The result is always `proposed`. */
    propose: (input) => insert(input, "proposed", null),
    /** USER ACTION: the researcher enters a claim by hand (run processor must be `manual`); stored confirmed. */
    async enterAsUser(input, { decidedBy = "user" } = {}) {
      return insert(input, "confirmed", { decidedBy: requireString(decidedBy, "decidedBy"), requireManual: true });
    },
    /** USER ACTION: accept a proposal. */
    confirmAssertion: (id, { decidedBy } = {}) => decide(id, "confirmed", decidedBy),
    /** USER ACTION: reject a proposal (kept, so the same wrong extraction is not proposed again). */
    rejectAssertion: (id, { decidedBy } = {}) => decide(id, "rejected", decidedBy),

    get: (id) => storage.dbGet(STORE, id).then((r) => r ?? null),
    listBySubject: (subjectId) => storage.dbGetAllByIndex(STORE, "bySubject", subjectId),
    listByObject: (personaId) => storage.dbGetAllByIndex(STORE, "byObject", personaId),
    listByRegion: (regionId) => storage.dbGetAllByIndex(STORE, "byRegion", regionId),
    listByStatus: (status) => storage.dbGetAllByIndex(STORE, "byStatus", status),
    listByRun: (runId) => storage.dbGetAllByIndex(STORE, "byRun", runId),
    /** All assertions for a region and property, any status (used to avoid re-proposing rejected ones). */
    findByRegionProperty: (regionId, property) => storage.dbGetAllByIndex(STORE, "byRegionProperty", [regionId, property]),
    /** Assertions about `subjectId` that no later assertion supersedes. */
    async listCurrentBySubject(subjectId) {
      const all = await storage.dbGetAllByIndex(STORE, "bySubject", subjectId);
      const superseded = new Set(all.map((a) => a.supersedesId).filter(Boolean));
      return all.filter((a) => !superseded.has(a.id));
    },
    /** Chain of corrections ending at `id`, oldest first. */
    async history(id) {
      const chain = [];
      let cur = await storage.dbGet(STORE, id);
      while (cur && !chain.some((c) => c.id === cur.id)) {
        chain.unshift(cur);
        cur = cur.supersedesId ? await storage.dbGet(STORE, cur.supersedesId) : null;
      }
      return chain;
    },
  };
}
