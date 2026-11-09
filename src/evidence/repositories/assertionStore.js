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
const STORE = "evAssertions", DECISIONS = "evAssertionDecisions";
const NO_REGION_AGENTS = ["manual", "import"]; // I2 exceptions

const isExtension = (p) => typeof p === "string" && /^x-[a-z0-9.-]+$/.test(p);

/**
 * Atomic claims about a record or persona. Source of truth for everything the conclusions layer uses.
 *  I1  assertions are never rewritten. A correction is a new assertion with `supersedesId`; a decision
 *      (confirm / reject) is a separate, append-only event row in `evAssertionDecisions` (one per assertion,
 *      enforced by a unique index). The stored assertion keeps its initial status; every reader below
 *      returns the EFFECTIVE status (initial status, or the decision if there is one).
 *  I2  a citation region is mandatory, except agent `manual` (source + page label) and `import` (source).
 *  I3  every assertion references the run that produced it; `agent` is that run's processor.
 *  I6  nothing is `confirmed` or `rejected` without an explicit user action: `propose` can only create
 *      proposals; `confirmAssertion`, `rejectAssertion`, `enterAsUser` and `supersedeAsUser` are the user-action entry points
 *      (the architecture test keeps automated modules from calling them).
 */
export function createAssertionStore(storage) {
  async function build(o, input, status, decision, byUser = false) {
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
      const prevDecision = await o.getByIndex(DECISIONS, "byAssertion", supersedesId);
      const prevStatus = prevDecision ? prevDecision.status : prev.status;
      if (prevStatus === "confirmed" && status !== "confirmed" && !byUser) throw new EvidenceError("invariant", "a confirmed assertion can only be superseded by a user action");
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
  const STORES = [STORE, DECISIONS, "evRuns", "evRecords", "evPersonas", "evRegions", "evSources"];

  async function insert(input, status, decision, byUser = false) {
    let rec;
    await storage.dbTransact(STORES, "readwrite", async (o) => {
      rec = await build(o, input, status, decision, byUser);
      if (decision?.requireManual && rec.agent !== "manual") throw new EvidenceError("invariant", "enterAsUser requires a run whose processor is 'manual'");
      await o.add(STORE, rec);
    });
    return rec;
  }

  /** Merge an assertion row with its decision event (if any) into the effective assertion. */
  const merge = (row, decision) => (decision ? { ...row, status: decision.status, decidedBy: decision.decidedBy, decidedAt: decision.decidedAt } : row);

  async function hydrate(rows) {
    if (!rows.length) return rows;
    return storage.dbTransact([DECISIONS], "readonly", async (o) => {
      const out = [];
      for (const row of rows) out.push(merge(row, row.status === "proposed" ? await o.getByIndex(DECISIONS, "byAssertion", row.id) : null));
      return out;
    });
  }
  const hydrateOne = async (row) => (row ? (await hydrate([row]))[0] : null);

  async function decide(id, status, decidedBy) {
    requireOneOf(status, ["confirmed", "rejected"], "status");
    const who = requireString(decidedBy, "decidedBy");
    let out;
    await storage.dbTransact([STORE, DECISIONS], "readwrite", async (o) => {
      const cur = await o.get(STORE, id);
      if (!cur) throw notFound("Assertion", id);
      if (cur.status !== "proposed" || (await o.getByIndex(DECISIONS, "byAssertion", id))) {
        throw new EvidenceError("conflict", "assertion has already been decided; make a correction instead");
      }
      const event = { id: newId(), assertionId: id, status, decidedBy: who, decidedAt: nowIso() };
      await o.add(DECISIONS, event); // the assertion row itself is never touched
      out = merge(cur, event);
    });
    return out;
  }

  return {
    /** Any agent may propose. The result is always `proposed`. */
    propose: (input) => insert(input, "proposed", null),
    /**
     * USER ACTION: the researcher replaces an assertion (even a confirmed one) with a new PROPOSED one, e.g. by
     * editing a fact or withdrawing a verification. `supersedesId` is required; confirm it separately if wanted.
     */
    supersedeAsUser(input) {
      if (!input?.supersedesId) return Promise.reject(invalid("supersedeAsUser requires supersedesId"));
      return insert(input, "proposed", null, true);
    },
    /** USER ACTION: the researcher enters a claim by hand (run processor must be `manual`); stored confirmed. */
    async enterAsUser(input, { decidedBy = "user" } = {}) {
      return insert(input, "confirmed", { decidedBy: requireString(decidedBy, "decidedBy"), requireManual: true });
    },
    /** USER ACTION: accept a proposal. */
    confirmAssertion: (id, { decidedBy } = {}) => decide(id, "confirmed", decidedBy),
    /** USER ACTION: reject a proposal (kept, so the same wrong extraction is not proposed again). */
    rejectAssertion: (id, { decidedBy } = {}) => decide(id, "rejected", decidedBy),

    /** The assertion with its effective status. */
    get: (id) => storage.dbGet(STORE, id).then((r) => hydrateOne(r ?? null)),
    /** The stored assertion exactly as written (initial status, no decision merged). */
    getStored: (id) => storage.dbGet(STORE, id).then((r) => r ?? null),
    /** Audit trail: decision events for an assertion (at most one). */
    decisionsFor: (assertionId) => storage.dbGetAllByIndex(DECISIONS, "byAssertion", assertionId),
    listBySubject: (subjectId) => storage.dbGetAllByIndex(STORE, "bySubject", subjectId).then(hydrate),
    listByObject: (personaId) => storage.dbGetAllByIndex(STORE, "byObject", personaId).then(hydrate),
    listByRegion: (regionId) => storage.dbGetAllByIndex(STORE, "byRegion", regionId).then(hydrate),
    listByRun: (runId) => storage.dbGetAllByIndex(STORE, "byRun", runId).then(hydrate),
    /** By EFFECTIVE status: `proposed` = not decided; `confirmed` includes claims the user entered directly. */
    async listByStatus(status) {
      requireOneOf(status, STATUSES, "status");
      const ids = new Set(), rows = [];
      const add = (r) => { if (r && !ids.has(r.id)) { ids.add(r.id); rows.push(r); } };
      if (status === "proposed") {
        for (const r of await storage.dbGetAllByIndex(STORE, "byStatus", "proposed")) add(r);
      } else {
        if (status === "confirmed") for (const r of await storage.dbGetAllByIndex(STORE, "byStatus", "confirmed")) add(r);
        for (const d of await storage.dbGetAllByIndex(DECISIONS, "byStatus", status)) add(await storage.dbGet(STORE, d.assertionId));
      }
      return (await hydrate(rows)).filter((r) => r.status === status);
    },
    /** All assertions for a region and property, any status (used to avoid re-proposing rejected ones). */
    findByRegionProperty: (regionId, property) => storage.dbGetAllByIndex(STORE, "byRegionProperty", [regionId, property]).then(hydrate),
    /** Assertions about `subjectId` that no later assertion supersedes. */
    async listCurrentBySubject(subjectId) {
      const all = await hydrate(await storage.dbGetAllByIndex(STORE, "bySubject", subjectId));
      const superseded = new Set(all.map((a) => a.supersedesId).filter(Boolean));
      return all.filter((a) => !superseded.has(a.id));
    },
    /** Chain of corrections ending at `id`, oldest first. */
    async history(id) {
      const chain = [];
      let cur = await hydrateOne(await storage.dbGet(STORE, id));
      while (cur && !chain.some((c) => c.id === cur.id)) {
        chain.unshift(cur);
        cur = cur.supersedesId ? await hydrateOne(await storage.dbGet(STORE, cur.supersedesId)) : null;
      }
      return chain;
    },
  };
}
