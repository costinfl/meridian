/*
 * Small constructors for the other conclusion lists in the project document (evidence-model.md, Layer 4).
 * Pure functions: each returns a new project.
 */
const isoNow = () => new Date().toISOString();
const add = (project, key, item) => ({ ...project, [key]: [...(project[key] ?? []), item] });

export const RELATIONSHIP_TYPES = ["godparent", "neighbour", "associate", "guardian", "other"];
export const RELATIONSHIP_STATUSES = ["candidate", "accepted", "rejected"];
export const EVIDENCE_STANCES = ["supports", "contradicts"];
export const CONCLUSION_KINDS = ["fact", "family", "link", "relationship"];

/** A concluded tie between two persons other than parent/spouse (those go through Family). Starts as a candidate. */
export function addRelationship(project, { personAId, personBId, type = "other", rationale = "" } = {}) {
  if (!personAId || !personBId || personAId === personBId) throw new Error("a relationship needs two different persons");
  if (!RELATIONSHIP_TYPES.includes(type)) throw new Error(`unknown relationship type: ${type}`);
  const item = { id: crypto.randomUUID(), personAId, personBId, type, status: "candidate", rationale, createdAt: isoNow() };
  return { project: add(project, "relationships", item), item };
}

/** Assertions that support or contradict a conclusion (a fact, family, link or relationship). */
export function addConclusionEvidence(project, { conclusion, assertionId, stance = "supports" } = {}) {
  if (!conclusion || !CONCLUSION_KINDS.includes(conclusion.kind) || !conclusion.id) throw new Error("conclusion must be { kind: fact|family|link|relationship, id }");
  if (!assertionId) throw new Error("assertionId is required");
  if (!EVIDENCE_STANCES.includes(stance)) throw new Error(`stance must be one of: ${EVIDENCE_STANCES.join(", ")}`);
  const exists = (project.conclusionEvidence ?? []).find((e) => e.conclusion.kind === conclusion.kind && e.conclusion.id === conclusion.id && e.assertionId === assertionId);
  if (exists) return { project, item: exists };
  const item = { id: crypto.randomUUID(), conclusion: { kind: conclusion.kind, id: conclusion.id }, assertionId, stance, createdAt: isoNow() };
  return { project: add(project, "conclusionEvidence", item), item };
}

/** Written reasoning where evidence conflicts. `subjects` are conclusion refs { kind, id }. */
export function addProofNote(project, { subjects = [], text } = {}) {
  if (!String(text ?? "").trim()) throw new Error("a proof note needs text");
  const item = { id: crypto.randomUUID(), subjects: subjects.map((s) => ({ kind: s.kind, id: s.id })), text: String(text).trim(), createdAt: isoNow() };
  return { project: add(project, "proofNotes", item), item };
}
