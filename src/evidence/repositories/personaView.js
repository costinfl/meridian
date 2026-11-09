import { notFound } from "../domain/errors.js";
import { fromStatedAge } from "../domain/fuzzyDate.js";
import { createAssertionStore } from "./assertionStore.js";

const newest = (a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);
const summary = (a) => ({
  assertionId: a.id, original: a.originalValue, normalized: a.normalizedValue, confidence: a.confidence,
  agent: a.agent, citationRegionId: a.citationRegionId, citation: a.citation, decidedBy: a.decidedBy, decidedAt: a.decidedAt,
});

/**
 * Convenience view of a persona: the CURRENT (not superseded) CONFIRMED assertions folded into fields.
 * Proposed and rejected assertions never appear in `facts`; proposals are listed in `pending` so a
 * reviewer can see what is waiting. Read-only and recomputed on demand (nothing here is stored).
 */
export function createPersonaView(storage) {
  const assertions = createAssertionStore(storage); // effective statuses (decisions are separate events)
  async function load(personaId) {
    const persona = await storage.dbGet("evPersonas", personaId);
    if (!persona) throw notFound("Persona", personaId);
    const record = await storage.dbGet("evRecords", persona.recordId);
    const [asSubject, asObject] = await Promise.all([
      assertions.listBySubject(personaId),
      assertions.listByObject(personaId),
    ]);
    return { persona, record, asSubject, asObject };
  }

  function fold({ persona, record, asSubject, asObject }) {
    const superseded = new Set([...asSubject, ...asObject].map((a) => a.supersedesId).filter(Boolean));
    const current = (list) => list.filter((a) => !superseded.has(a.id));
    const subjectCurrent = current(asSubject);
    const confirmed = subjectCurrent.filter((a) => a.status === "confirmed");

    const facts = {}, conflicts = {};
    const byProperty = new Map();
    for (const a of confirmed.filter((x) => !x.objectPersonaId)) {
      byProperty.set(a.property, [...(byProperty.get(a.property) ?? []), a]);
    }
    for (const [property, list] of byProperty) {
      list.sort(newest);
      facts[property] = summary(list[0]);
      const distinct = new Map(list.map((a) => [JSON.stringify(a.normalizedValue), a]));
      if (distinct.size > 1) conflicts[property] = list.map((a) => a.id); // chosen, not merged: the newest is shown, all stay visible
    }

    const relation = (a) => ({ property: a.property, subjectPersonaId: a.subjectId, objectPersonaId: a.objectPersonaId, assertionId: a.id });
    const relations = confirmed.filter((a) => a.objectPersonaId).sort(newest).map(relation);
    const relationsIn = current(asObject).filter((a) => a.status === "confirmed").sort(newest).map(relation);
    const pending = subjectCurrent.filter((a) => a.status === "proposed").sort(newest).map((a) => a.id);

    // derived, never stored: a birth range from a stated age at the record's event date
    let birthRange = null;
    const age = facts.age?.normalized ?? persona.statedAge;
    if (!facts["birth.date"] && age && record?.event) {
      try { birthRange = fromStatedAge(age, record.event, { asWritten: facts.age?.original ?? persona.statedAge?.asWritten ?? "" }); } catch { birthRange = null; }
    }

    return {
      personaId: persona.id,
      recordId: persona.recordId,
      asWritten: {
        nameAsWritten: persona.nameAsWritten, role: persona.role, statedAge: persona.statedAge, occupation: persona.occupation,
        residence: persona.residence, houseNumber: persona.houseNumber,
      },
      facts, conflicts, relations, relationsIn, pending,
      name: facts.name?.normalized ?? null,
      role: facts.role?.normalized ?? persona.role,
      derived: { birthRange },
    };
  }

  return {
    async forPersona(personaId) { return fold(await load(personaId)); },
    async forRecord(recordId) {
      const personas = await storage.dbGetAllByIndex("evPersonas", "byRecord", recordId);
      return Promise.all(personas.map(async (p) => fold(await load(p.id))));
    },
  };
}
