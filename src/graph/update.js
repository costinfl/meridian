import { markOf, newerThan } from "../evidence/index.js";
import { buildGraph, prepareRecords, recordPart, addRecordPart, removeRecord, personLayer } from "./projection.js";

// Keeping the graph up to date (P8.T2). Record parts are rebuilt only for records touched since the graph was
// built (new records, personas, assertions, decisions, and records on a changed copy or source); the person layer
// (people, families, links, relationships) is rebuilt when its fingerprint changes. The result equals a full
// rebuild (I7, tested).

/** A short, stable fingerprint of the project inputs of the person layer. */
export function personFingerprint({ people = [], families = [], links = [], relationships = [] }) {
  const s = JSON.stringify([
    people.map((p) => [p.id, p.name ?? "", p.sex ?? ""]).sort(),
    families.map((f) => [f.id, f.partner1Id, f.partner2Id, f.status ?? "", (f.children ?? []).map((c) => c.personId).sort()]).sort(),
    links.map((l) => [l.id, l.personId, l.personaId, l.status, l.score ?? null]).sort(),
    relationships.map((r) => [r.id, r.personAId, r.personBId, r.type, r.status]).sort(),
  ]);
  let h = 2166136261;                                       // FNV-1a, 32 bit
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `${(h >>> 0).toString(16)}:${s.length}`;
}

/** Build a graph and remember what it has seen. */
export function buildTrackedGraph(inputs) {
  const g = buildGraph(inputs);
  g.seen = markOf(inputs.snapshot);
  g.personPrint = personFingerprint(inputs);
  return g;
}

/** The records whose part may have changed since `seen`. */
export function changedRecords(snapshot, seen) {
  const newer = newerThan(seen);
  const ids = new Set();
  const personaRecord = new Map(snapshot.personas.map((p) => [p.id, p.recordId]));
  const recordIds = new Set(snapshot.records.map((r) => r.id));
  const recordOfSubject = (subjectId) => (recordIds.has(subjectId) ? subjectId : personaRecord.get(subjectId));
  const assertionById = new Map(snapshot.assertions.map((a) => [a.id, a]));
  for (const r of snapshot.records) if (newer("records")(r)) ids.add(r.id);
  for (const p of snapshot.personas) if (newer("personas")(p)) ids.add(p.recordId);
  for (const a of snapshot.assertions) if (newer("assertions")(a)) {
    ids.add(recordOfSubject(a.subjectId));
    if (a.supersedesId) ids.add(recordOfSubject(assertionById.get(a.supersedesId)?.subjectId));
  }
  for (const d of snapshot.decisions) if (newer("decisions")(d)) ids.add(recordOfSubject(assertionById.get(d.assertionId)?.subjectId));
  // a copy (or its source) changed: the records cited on its pages show its source
  const sources = new Set(snapshot.sources.filter(newer("sources")).map((s) => s.id));
  const copies = new Set(snapshot.copies.filter((c) => newer("copies")(c) || sources.has(c.sourceId)).map((c) => c.id));
  if (copies.size) {
    const pages = new Set(snapshot.pages.filter((p) => copies.has(p.copyId)).map((p) => p.id));
    const regions = new Set(snapshot.regions.filter((r) => pages.has(r.pageId)).map((r) => r.id));
    for (const r of snapshot.records) if ((r.regionIds ?? []).some((id) => regions.has(id))) ids.add(r.id);
  }
  ids.delete(undefined); ids.delete(null);
  return [...ids].sort();
}

/** Bring `g` up to date with `inputs`. Returns { graph, records, personLayer: boolean }. */
export function updateGraph(g, inputs) {
  if (!g?.seen) { const fresh = buildTrackedGraph(inputs); return { graph: fresh, records: fresh.records.size, personLayer: true }; }
  const changed = changedRecords(inputs.snapshot, g.seen);
  if (changed.length) {
    const ctx = prepareRecords(inputs.snapshot);
    for (const id of changed) { removeRecord(g, id); addRecordPart(g, recordPart(ctx, id)); }
  }
  const print = personFingerprint(inputs);
  const personChanged = print !== g.personPrint;
  if (personChanged) Object.assign(g, personLayer(inputs));
  g.seen = markOf(inputs.snapshot);
  g.personPrint = print;
  return { graph: g, records: changed.length, personLayer: personChanged };
}
