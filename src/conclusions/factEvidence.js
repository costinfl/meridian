import { addConclusionEvidence } from "./conclusions.js";

// Evidence on the timeline (P6.T5): which assertions back a timeline fact, where they were read, and attaching a
// confirmed assertion to a fact. A fact is identified like the legacy conversion does: "<personId>#birth",
// "<personId>#death", or "<personId>#<event|period|group>:<factId>".

export const FACT_KINDS = ["birth", "death", "event", "period", "group"];
const ARRAY_OF = { event: "events", period: "periods", group: "groups" };

export function factRefOf(personId, kind, factId = null) {
  if (!FACT_KINDS.includes(kind)) throw new Error(`not a fact kind: ${kind}`);
  return kind === "birth" || kind === "death" ? `${personId}#${kind}` : `${personId}#${kind}:${factId}`;
}

function factOf(project, personId, kind, factId) {
  const person = (project.people ?? []).find((p) => p.id === personId);
  if (!person) return { person: null, fact: null };
  const fact = kind === "birth" || kind === "death" ? person[kind] : (person[ARRAY_OF[kind]] ?? []).find((f) => f.id === factId);
  return { person, fact: fact ?? null };
}

/** Where an assertion was read: { assertion, subject (persona or record), record, region, page, copy, source }. */
export async function provenanceOf(library, assertion) {
  const persona = assertion.subjectType === "persona" ? await library.records.getPersona(assertion.subjectId) : null;
  const record = persona ? await library.records.getRecord(persona.recordId) : assertion.subjectType === "record" ? await library.records.getRecord(assertion.subjectId) : null;
  const region = assertion.citation?.regionId ? await library.pages.getRegion(assertion.citation.regionId) : null;
  const page = region ? await library.pages.getPage(region.pageId) : null;
  const copy = page ? await library.copies.get(page.copyId) : null;
  const sourceId = copy?.sourceId ?? assertion.citation?.sourceId ?? null;
  const source = sourceId ? await library.sources.get(sourceId) : null;
  const object = assertion.objectPersonaId ? await library.records.getPersona(assertion.objectPersonaId) : null;
  return { assertion, persona, record, region, page, copy, source, object };
}

/** The assertions of a fact (fact.assertionIds, latest versions) with their provenance. */
export async function factEvidence(library, fact) {
  const all = (await Promise.all((fact?.assertionIds ?? []).map((id) => library.assertions.get(id)))).filter(Boolean);
  const superseded = new Set(all.map((a) => a.supersedesId).filter(Boolean));
  return Promise.all(all.filter((a) => !superseded.has(a.id)).map((a) => provenanceOf(library, a)));
}

/** Confirmed assertions about personas whose name matches `query`, with provenance, for "Attach evidence…". */
export async function searchConfirmedEvidence(library, query, { limit = 40 } = {}) {
  const out = [];
  for (const persona of await library.records.searchPersonas(query)) {
    const own = await library.assertions.listCurrentBySubject(persona.id);
    const rec = await library.assertions.listCurrentBySubject(persona.recordId);
    for (const a of [...own, ...rec]) {
      if (a.status !== "confirmed" || out.some((x) => x.assertion.id === a.id)) continue;
      out.push(await provenanceOf(library, a));
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Pure: the project with `assertionId` attached to the fact (once) and a conclusionEvidence entry. */
export function attachToProject(project, { personId, kind, factId = null, assertionId, stance = "supports" }) {
  const { fact } = factOf(project, personId, kind, factId);
  if (!fact) throw new Error("that fact no longer exists");
  const withId = (f) => (f.assertionIds ?? []).includes(assertionId) ? f : { ...f, assertionIds: [...(f.assertionIds ?? []), assertionId] };
  const people = project.people.map((p) => {
    if (p.id !== personId) return p;
    if (kind === "birth" || kind === "death") return { ...p, [kind]: withId(p[kind]) };
    return { ...p, [ARRAY_OF[kind]]: p[ARRAY_OF[kind]].map((f) => (f.id === factId ? withId(f) : f)) };
  });
  return addConclusionEvidence({ ...project, people }, { conclusion: { kind: "fact", id: factRefOf(personId, kind, factId) }, assertionId, stance }).project;
}

/**
 * USER ACTION: attach a confirmed assertion to a timeline fact. Returns the new project: the fact's
 * `assertionIds` gains the id (once), and `conclusionEvidence` records that it supports (or contradicts) the fact.
 * The fact's own values are not changed. Only CONFIRMED evidence can be attached.
 */
export async function attachAssertionToFact({ library, project, personId, kind, factId = null, assertionId, stance = "supports" }) {
  const assertion = await library.assertions.get(assertionId);
  if (!assertion) throw new Error("that evidence no longer exists");
  if (assertion.status !== "confirmed") throw new Error("only confirmed evidence can be attached to a fact; confirm it first");
  return attachToProject(project, { personId, kind, factId, assertionId, stance });
}
