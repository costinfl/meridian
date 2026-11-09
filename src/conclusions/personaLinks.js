/*
 * PersonaLinks: the decision that a persona (a person as described in one record) is a Person of this project.
 * Stored in project.personaLinks as an append-only list: a decision does not edit a link, it adds a new link that
 * supersedes the old one. Nothing becomes `accepted` without a user action (I6): `addLink` can only create
 * `candidate` links; `decideLink` is the user-action entry point (the architecture test keeps automated modules
 * from calling it). Rejected links are kept so a false match is not suggested again.
 * Pure functions on the project object.
 */

export const LINK_STATUSES = ["candidate", "accepted", "rejected"];

const isoNow = () => new Date().toISOString();
const own = (project) => project.personaLinks ?? [];

/** Links that no later link supersedes. */
export function currentLinks(project) {
  const superseded = new Set(own(project).map((l) => l.supersedesId).filter(Boolean));
  return own(project).filter((l) => !superseded.has(l.id));
}

export const linksOfPerson = (project, personId) => currentLinks(project).filter((l) => l.personId === personId);
export const linksOfPersona = (project, personaId) => currentLinks(project).filter((l) => l.personaId === personaId);
export const currentLinkFor = (project, personId, personaId) =>
  currentLinks(project).find((l) => l.personId === personId && l.personaId === personaId) ?? null;

/** A rejected pair must not be suggested again. */
export const isRejectedPair = (project, personId, personaId) => currentLinkFor(project, personId, personaId)?.status === "rejected";

/** Add a CANDIDATE link (any status passed in is ignored). Returns { project, link }; the same project if the pair already has a current link. */
export function addLink(project, { personId, personaId, method = "manual", score = null, signals = null, rationale = "" } = {}) {
  if (!personId || !personaId) throw new Error("addLink needs personId and personaId");
  const existing = currentLinkFor(project, personId, personaId);
  if (existing) return { project, link: existing };
  const link = {
    id: crypto.randomUUID(), personId, personaId, status: "candidate",
    score, signals, method, rationale, decidedBy: null, decidedAt: null, supersedesId: null, createdAt: isoNow(),
  };
  return { project: { ...project, personaLinks: [...own(project), link] }, link };
}

/**
 * USER ACTION: accept or reject a link. Adds a new link superseding the current one for that pair, so the
 * history stays. `decidedBy` is required (who decided).
 */
export function decideLink(project, linkId, status, { decidedBy, rationale } = {}) {
  if (!["accepted", "rejected"].includes(status)) throw new Error("status must be accepted or rejected");
  if (!decidedBy || !String(decidedBy).trim()) throw new Error("decidedBy is required");
  const current = currentLinks(project).find((l) => l.id === linkId);
  if (!current) throw new Error(`No current link ${linkId} (unknown or already superseded)`);
  if (current.status === status) return { project, link: current };
  const link = {
    ...current, id: crypto.randomUUID(), status, rationale: rationale ?? current.rationale,
    decidedBy: String(decidedBy).trim(), decidedAt: isoNow(), supersedesId: current.id, createdAt: isoNow(),
  };
  let next = { ...project, personaLinks: [...own(project), link] };
  // a display-name choice that rests on a link no longer accepted would show a name the researcher rejected
  if (status !== "accepted") {
    next = { ...next, people: (next.people ?? []).map((p) => (p.id === current.personId && p.displayNameChoice?.personaId === current.personaId ? { ...p, displayNameChoice: null } : p)) };
  }
  return { project: next, link };
}

/** Personas accepted for a person, earliest decision first (this order defines the "first name identified"). */
export function acceptedLinksInOrder(project, personId) {
  return linksOfPerson(project, personId)
    .filter((l) => l.status === "accepted")
    .sort((a, b) => (a.decidedAt < b.decidedAt ? -1 : a.decidedAt > b.decidedAt ? 1 : own(project).indexOf(a) - own(project).indexOf(b)));
}
