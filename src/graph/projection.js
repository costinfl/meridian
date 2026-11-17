// Graph projection (P8.T1): who appears with whom in which record, and how persons relate. Built in memory from
// the library snapshot and the project's people, families, persona links and relationships; never stored, always
// rebuildable (I7). Plain Maps; no graph library.
//
// Nodes and edges (evidence-model.md, "Graph projection"):
//   Persona  APPEARS_IN -> Record (role); CO_OCCURS <-> Persona (relation assertions, same record, same house)
//   Person   SAME_AS <- Persona (accepted, or candidate = "possible"); PARENT_OF -> Person; PARTNER <-> Person (Family);
//            RELATED <-> Person (accepted relationships)
//   Record   FROM -> Source; AT -> Place; date bounds
// Rejected or superseded assertions and rejected links are left out.

export const RELATION_PROPERTIES = ["childOf", "parentOf", "spouseOf", "godparentOf", "witnessFor", "informantFor"];

const push = (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value); };
const byId = (rows) => new Map(rows.map((r) => [r.id, r]));

/** Lookups over the snapshot shared by full builds and record-level updates. */
export function prepareRecords(snapshot) {
  const decisionOf = new Map(snapshot.decisions.map((d) => [d.assertionId, d]));
  const superseded = new Set(snapshot.assertions.map((a) => a.supersedesId).filter(Boolean));
  const live = snapshot.assertions.filter((a) => !superseded.has(a.id))
    .map((a) => ({ ...a, status: decisionOf.get(a.id)?.status ?? a.status }))
    .filter((a) => a.status !== "rejected");
  return {
    records: byId(snapshot.records),
    regions: byId(snapshot.regions),
    pages: byId(snapshot.pages),
    copies: byId(snapshot.copies),
    personasByRecord: snapshot.personas.reduce((m, p) => (push(m, p.recordId, p), m), new Map()),
    assertionsBySubject: live.reduce((m, a) => (push(m, a.subjectId, a), m), new Map()),
  };
}

/** The record node, its personas and their co-occurrence edges. Null if the record is gone. */
export function recordPart(ctx, recordId) {
  const rec = ctx.records.get(recordId);
  if (!rec) return null;
  const region = ctx.regions.get(rec.regionIds?.[0]);
  const page = region ? ctx.pages.get(region.pageId) : null;
  const copy = page ? ctx.copies.get(page.copyId) : null;
  const personas = [...(ctx.personasByRecord.get(rec.id) ?? [])].sort((a, b) => (a.id < b.id ? -1 : 1));
  // date: the record's event, else its event.date values
  let earliestDay = rec.event?.earliestDay ?? null, latestDay = rec.event?.latestDay ?? null, dateText = rec.event?.asWritten ?? "";
  if (earliestDay == null) {
    for (const a of ctx.assertionsBySubject.get(rec.id) ?? []) {
      if (a.property !== "event.date" || !Number.isInteger(a.normalizedValue?.earliestDay)) continue;
      earliestDay = earliestDay == null ? a.normalizedValue.earliestDay : Math.min(earliestDay, a.normalizedValue.earliestDay);
      latestDay = latestDay == null ? a.normalizedValue.latestDay : Math.max(latestDay, a.normalizedValue.latestDay);
      dateText = dateText || a.originalValue;
    }
  }
  const placeText = (ctx.assertionsBySubject.get(rec.id) ?? []).find((a) => a.property === "event.place")?.originalValue ?? "";
  const ev = rec.event;
  const dateLabel = ev?.earliest || ev?.latest ? `${ev.earliest === ev.latest ? ev.earliest : `${ev.earliest ?? "…"} – ${ev.latest ?? "…"}`}${ev.calendar ? ` (${ev.calendar})` : ""}` : dateText;
  const record = {
    id: rec.id, kind: rec.kind, earliestDay, latestDay, dateText, dateLabel, placeId: rec.placeId ?? null, placeText,
    regionId: rec.regionIds?.[0] ?? null, pageId: page?.id ?? null, pageIndex: page?.pageIndex ?? null, pageLabel: page?.label ?? "",
    copyId: copy?.id ?? null, fileName: copy?.fileName ?? "", sourceId: copy?.sourceId ?? null,
    personaIds: personas.map((p) => p.id),
  };
  const nodes = personas.map((p) => ({ id: p.id, recordId: rec.id, nameAsWritten: p.nameAsWritten, role: p.role, houseNumber: p.houseNumber ?? "", statedAge: p.statedAge ?? null }));
  // co-occurrence: every pair of personas in the record, with the relations stated between them
  const relations = new Map();   // "a|b" -> [{ property, from, to, originalValue, status }]
  for (const p of personas) {
    for (const a of ctx.assertionsBySubject.get(p.id) ?? []) {
      if (!RELATION_PROPERTIES.includes(a.property) || !a.objectPersonaId) continue;
      const k = [p.id, a.objectPersonaId].sort().join("|");
      push(relations, k, { property: a.property, from: p.id, to: a.objectPersonaId, originalValue: a.originalValue ?? "", status: a.status });
    }
  }
  const edges = [];
  for (let i = 0; i < personas.length; i++) for (let j = i + 1; j < personas.length; j++) {
    const a = personas[i], b = personas[j];
    const k = [a.id, b.id].sort().join("|");
    const rels = (relations.get(k) ?? []).sort((x, y) => (x.property + x.from < y.property + y.from ? -1 : 1));
    edges.push({ a: a.id, b: b.id, recordId: rec.id, relations: rels, sameHouse: !!(a.houseNumber && a.houseNumber === b.houseNumber) });
  }
  return { record, personas: nodes, edges };
}

/** The person layer: persons, families (parents, partners), links between personas and persons, relationships. */
export function personLayer({ people = [], families = [], links = [], relationships = [] }) {
  const persons = new Map(people.map((p) => [p.id, { id: p.id, name: p.name ?? "", sex: p.sex ?? "" }]));
  const parents = new Map(), children = new Map(), partners = new Map();
  const addPartner = (a, b) => { if (!partners.has(a)) partners.set(a, new Set()); partners.get(a).add(b); };
  for (const f of families) {
    if (f.status && f.status !== "accepted") continue;
    const ps = [f.partner1Id, f.partner2Id].filter(Boolean);
    if (ps.length === 2) { addPartner(ps[0], ps[1]); addPartner(ps[1], ps[0]); }
    for (const c of f.children ?? []) for (const p of ps) {
      if (!(parents.get(c.personId) ?? []).includes(p)) push(parents, c.personId, p);
      if (!(children.get(p) ?? []).includes(c.personId)) push(children, p, c.personId);
    }
  }
  const personaLinks = new Map(), personLinks = new Map();
  for (const l of links) {
    if (l.status !== "accepted" && l.status !== "candidate") continue;
    const link = { personId: l.personId, personaId: l.personaId, status: l.status, score: l.score ?? null, linkId: l.id };
    push(personaLinks, l.personaId, link);
    push(personLinks, l.personId, link);
  }
  const related = new Map();
  for (const r of relationships) {
    if (r.status !== "accepted") continue;
    push(related, r.personAId, { personId: r.personBId, type: r.type });
    push(related, r.personBId, { personId: r.personAId, type: r.type });
  }
  return { persons, parents, children, partners, personaLinks, personLinks, related };
}

/** The whole graph. */
export function buildGraph({ snapshot, people, families, links, relationships }) {
  const ctx = prepareRecords(snapshot);
  const g = { records: new Map(), personas: new Map(), coOccurs: new Map(), ...personLayer({ people, families, links, relationships }) };
  for (const id of [...ctx.records.keys()].sort()) addRecordPart(g, recordPart(ctx, id));
  return g;
}

/** Put a record part into the graph (used by build and update). */
export function addRecordPart(g, part) {
  if (!part) return;
  g.records.set(part.record.id, part.record);
  for (const p of part.personas) g.personas.set(p.id, p);
  for (const e of part.edges) {
    push(g.coOccurs, e.a, { other: e.b, recordId: e.recordId, relations: e.relations, sameHouse: e.sameHouse });
    push(g.coOccurs, e.b, { other: e.a, recordId: e.recordId, relations: e.relations, sameHouse: e.sameHouse });
  }
}

/** Take a record and everything attached to it out of the graph. */
export function removeRecord(g, recordId) {
  const rec = g.records.get(recordId);
  if (!rec) return;
  for (const pid of rec.personaIds) {
    g.personas.delete(pid);
    for (const e of g.coOccurs.get(pid) ?? []) {
      const back = (g.coOccurs.get(e.other) ?? []).filter((x) => x.recordId !== recordId);
      if (back.length) g.coOccurs.set(e.other, back); else g.coOccurs.delete(e.other);
    }
    g.coOccurs.delete(pid);
  }
  g.records.delete(recordId);
}

/** A canonical, comparable view of a graph (for tests and I7): sorted plain objects. */
export function canonical(g) {
  const sortObj = (m) => Object.fromEntries([...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
  const sortList = (m, key) => Object.fromEntries([...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, [...v].sort((x, y) => (key(x) < key(y) ? -1 : key(x) > key(y) ? 1 : 0))]));
  return {
    records: sortObj(g.records), personas: sortObj(g.personas),
    coOccurs: sortList(g.coOccurs, (e) => `${e.recordId}|${e.other}`),
    persons: sortObj(g.persons),
    parents: sortList(g.parents, (x) => x), children: sortList(g.children, (x) => x),
    partners: sortList(new Map([...g.partners].map(([k, s]) => [k, [...s]])), (x) => x),
    personaLinks: sortList(g.personaLinks, (l) => `${l.personId}|${l.status}`), personLinks: sortList(g.personLinks, (l) => `${l.personaId}|${l.status}`),
    related: sortList(g.related, (r) => `${r.personId}|${r.type}`),
  };
}
