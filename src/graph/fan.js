import { toJdn } from "../evidence/domain/fuzzyDate.js";

// FAN queries (P8.T3): family, associates and neighbours of a person or persona, read from the records they appear
// in. Accepted links are followed; candidate links are included but marked "possible"; rejected links never.
// Bounded: one or two steps, a visited set, and a cap on records.

const MAX_RECORDS = 300;
const yearBounds = (from, to) => [Number.isInteger(from) ? toJdn(from, 1, 1, "gregorian") : -Infinity, Number.isInteger(to) ? toJdn(to, 12, 31, "gregorian") : Infinity];

/** Persons a persona is linked to: [{ personId, name, status }] (accepted first). */
export function personsOfPersona(g, personaId) {
  return (g.personaLinks.get(personaId) ?? [])
    .map((l) => ({ personId: l.personId, name: g.persons.get(l.personId)?.name ?? "", status: l.status, score: l.score }))
    .sort((a, b) => (a.status === b.status ? 0 : a.status === "accepted" ? -1 : 1));
}

/** One record seen from one of its personas. */
function entryOf(g, personaId, link) {
  const self = g.personas.get(personaId);
  const record = self ? g.records.get(self.recordId) : null;
  if (!record) return null;
  const others = (g.coOccurs.get(personaId) ?? []).filter((e) => e.recordId === record.id).map((e) => {
    const p = g.personas.get(e.other);
    return {
      persona: p,
      // relations stated between the two, as seen from the other person: "godparentOf (them -> self)" etc.
      relations: e.relations.map((r) => ({ ...r, direction: r.from === e.other ? "theirs" : "mine" })),
      sameHouse: e.sameHouse,
      persons: personsOfPersona(g, e.other),
    };
  }).sort((a, b) => (a.persona.role + a.persona.nameAsWritten < b.persona.role + b.persona.nameAsWritten ? -1 : 1));
  return { record, self, link, others };
}

/**
 * @param {object} g  the graph
 * @param {object} q  { personId | personaId, hops = 1 (1 or 2), roles?: string[] (keep records where someone has one
 *                    of these roles), fromYear?, toYear? }
 * @returns {{ entries, second, possible }}  entries newest first; `second`: [{ person, entries }] one step further
 */
export function fanOf(g, { personId = null, personaId = null, hops = 1, roles = null, fromYear, toYear } = {}) {
  const [d0, d1] = yearBounds(fromYear, toYear);
  const dated = Number.isFinite(d0) || Number.isFinite(d1);
  const roleSet = roles?.length ? new Set(roles) : null;
  const keep = (entry) => {
    const r = entry.record;
    if (dated && (r.earliestDay == null || r.latestDay < d0 || r.earliestDay > d1)) return false;
    if (roleSet && !entry.others.some((o) => roleSet.has(o.persona.role))) return false;
    return true;
  };
  const sort = (list) => list.sort((a, b) => (b.record.earliestDay ?? -Infinity) - (a.record.earliestDay ?? -Infinity) || (a.record.id < b.record.id ? -1 : 1));

  const startsOf = (pid) => (g.personLinks.get(pid) ?? []).map((l) => ({ personaId: l.personaId, link: l }));
  const starts = personId ? startsOf(personId) : personaId ? [{ personaId, link: null }] : [];
  const visitedPersonas = new Set(starts.map((s) => s.personaId));
  const entries = sort(starts.map((s) => entryOf(g, s.personaId, s.link)).filter(Boolean).filter(keep)).slice(0, MAX_RECORDS);
  const out = { entries, second: [], possible: entries.filter((e) => e.link?.status === "candidate").length };
  if (hops < 2) return out;

  // one step further: the records of the persons the associates are linked to (accepted links only)
  const seenPersons = new Set(personId ? [personId] : []);
  const seenRecords = new Set(entries.map((e) => e.record.id));                 // a record is shown once
  let budget = MAX_RECORDS - entries.length;
  for (const e of entries) for (const o of e.others) for (const p of o.persons) {
    if (p.status !== "accepted" || seenPersons.has(p.personId) || budget <= 0) continue;
    seenPersons.add(p.personId);
    const theirs = startsOf(p.personId).filter((s) => !visitedPersonas.has(s.personaId) && !seenRecords.has(g.personas.get(s.personaId)?.recordId));
    theirs.forEach((s) => { visitedPersonas.add(s.personaId); seenRecords.add(g.personas.get(s.personaId)?.recordId); });
    const list = sort(theirs.map((s) => entryOf(g, s.personaId, s.link)).filter(Boolean).filter(keep)).slice(0, budget);
    budget -= list.length;
    if (list.length) out.second.push({ person: g.persons.get(p.personId) ?? { id: p.personId, name: p.name }, via: o.persona, entries: list });
  }
  return out;
}

/**
 * Groups of personas and persons tied together by CANDIDATE links (connected components), e.g. three personas
 * that may all be the same person. Input for entity resolution review (Phase 9). Components of one node are left out.
 */
export function candidateClusters(g) {
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { for (const x of [a, b]) if (!parent.has(x)) parent.set(x, x); const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb); };
  for (const [personaId, links] of g.personaLinks) for (const l of links) if (l.status === "candidate") union(`persona:${personaId}`, `person:${l.personId}`);
  const groups = new Map();
  for (const x of parent.keys()) { const r = find(x); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(x); }
  return [...groups.values()].filter((m) => m.length > 1).map((m) => ({
    personIds: m.filter((x) => x.startsWith("person:")).map((x) => x.slice(7)).sort(),
    personaIds: m.filter((x) => x.startsWith("persona:")).map((x) => x.slice(8)).sort(),
  })).sort((a, b) => b.personaIds.length + b.personIds.length - (a.personaIds.length + a.personIds.length));
}
