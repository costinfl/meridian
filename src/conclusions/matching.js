/*
 * Matching results on the project (Phase 9). A matching run (src/resolve) computes proposals; `applyMatches` puts
 * them on the project as CANDIDATE links (addLink) and open groups and accepts nothing (I6). Pairs with a current link
 * of any status, and rejected pairs, are never proposed again; a dismissed group pair is never grouped again. The
 * review decisions further down are USER ACTIONS (decidedBy required; automated modules may not call them).
 * Pure functions on the project object.
 *
 *   project.matchGroups:    [{ id, personaIds, score, usesProposed, pairs, runId, createdAt, status: "open" }]
 *   project.matchDismissed: ["personaA|personaB"]   pairs you said are not the same person
 *   project.settings.matching: { mark, prints, lastRun: { runId, at, scope, counts } , weights?, threshold? }
 */
import { addLink, currentLinkFor, currentLinks, decideLink } from "./personaLinks.js";

export const MATCH_METHOD = "entity-resolution";
const isoNow = () => new Date().toISOString();
export const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** The matching state kept between runs (for incremental runs) and the last run's summary. */
export const matchingState = (project) => project?.settings?.matching ?? null;

/**
 * Put a run's results on the project. Returns { project, added, skipped }.
 * @param {object} result  findMatches(...) output
 * @param {object} run     { id } the ProcessingRun of this matching run
 */
export function applyMatches(project, result, run) {
  let next = project;
  let added = 0, skipped = 0;
  for (const p of result.proposals) {
    if (currentLinkFor(next, p.personId, p.personaId)) { skipped++; continue; }    // decided or proposed meanwhile (rejected stays rejected)
    const signals = { ...p.signals, usesProposed: !!p.usesProposed, runId: run.id, relativesMatched: p.detail?.relatives ?? [], fanShared: p.detail?.fanShared ?? [] };
    const r = addLink(next, { personId: p.personId, personaId: p.personaId, method: MATCH_METHOD, score: p.score, signals, rationale: `Matching run ${run.id.slice(0, 8)}` });
    next = r.project; added++;
  }
  // groups: a new group replaces open groups that share a persona with it; personas linked meanwhile are dropped
  const dismissed = new Set(next.matchDismissed ?? []);
  const linkedNow = new Set((next.personaLinks ?? []).filter((l) => l.status !== "rejected").map((l) => l.personaId));
  const fresh = result.groups
    .map((g) => ({ ...g, personaIds: g.personaIds.filter((id) => !linkedNow.has(id)) }))
    .filter((g) => g.personaIds.length >= 2 && !g.pairs.every((e) => dismissed.has(pairKey(e.a, e.b))))
    .map((g) => ({ id: crypto.randomUUID(), personaIds: g.personaIds, score: g.score, usesProposed: !!g.usesProposed, pairs: g.pairs, runId: run.id, createdAt: isoNow(), status: "open" }));
  const touched = new Set(fresh.flatMap((g) => g.personaIds));
  const kept = (next.matchGroups ?? []).filter((g) => g.status !== "open" || !g.personaIds.some((id) => touched.has(id)));
  const settings = { ...(next.settings ?? {}) };
  settings.matching = { ...(settings.matching ?? {}), mark: result.mark, prints: result.prints, lastRun: { runId: run.id, at: isoNow(), scope: result.scope, counts: { ...result.counts, added, skipped } } };
  next = { ...next, matchGroups: [...kept, ...fresh], settings };
  return { project: next, added, skipped, groups: fresh.length };
}

/** Candidate links proposed by matching that are still waiting for a decision. */
export const waitingMatches = (links) => links.filter((l) => l.method === MATCH_METHOD && l.status === "candidate");
export const openGroups = (project) => (project?.matchGroups ?? []).filter((g) => g.status === "open");

/* ---------- user actions (Matches review, P9.T4). Each is a decision by the researcher (decidedBy required). ---------- */

const need = (decidedBy) => { if (!decidedBy || !String(decidedBy).trim()) throw new Error("decidedBy is required"); };

/** Reject every other waiting candidate of the persona (a persona is one person), keeping `exceptLinkId`. */
function rejectOthers(project, personaId, exceptLinkId, decidedBy, rationale) {
  let next = project;
  for (const l of currentLinks(next).filter((x) => x.personaId === personaId && x.status === "candidate" && x.id !== exceptLinkId)) {
    next = decideLink(next, l.id, "rejected", { decidedBy, rationale }).project;
  }
  return next;
}

/** USER ACTION: accept a proposed match; the persona's other waiting candidates are rejected (another person was chosen). */
export function acceptMatch(project, linkId, { decidedBy } = {}) {
  need(decidedBy);
  const link = currentLinks(project).find((l) => l.id === linkId);
  if (!link) throw new Error(`No current link ${linkId}`);
  const next = decideLink(project, linkId, "accepted", { decidedBy }).project;
  return { project: rejectOthers(next, link.personaId, null, decidedBy, "Another person was accepted for this record") };
}

/** USER ACTION: reject a proposed match (it is never proposed again). */
export function rejectMatch(project, linkId, { decidedBy, rationale } = {}) {
  need(decidedBy);
  return { project: decideLink(project, linkId, "rejected", { decidedBy, rationale }).project };
}

/** Link a persona to a person and accept it (reusing a waiting candidate for that pair). */
function acceptPair(project, personId, personaId, decidedBy, rationale) {
  let next = project;
  let link = currentLinkFor(next, personId, personaId);
  if (link?.status === "accepted") return next;
  if (!link || link.status === "rejected") {
    // a rejected pair can still be linked by hand: a new decision supersedes the rejection
    if (link?.status === "rejected") next = { ...next, personaLinks: [...next.personaLinks, { ...link, id: crypto.randomUUID(), status: "candidate", method: "manual", decidedBy: null, decidedAt: null, supersedesId: link.id, createdAt: isoNow() }] };
    else next = addLink(next, { personId, personaId, method: "manual", rationale }).project;
    link = currentLinkFor(next, personId, personaId);
  }
  next = decideLink(next, link.id, "accepted", { decidedBy, rationale }).project;
  return rejectOthers(next, personaId, null, decidedBy, "Another person was accepted for this record");
}

/** USER ACTION: the proposal is wrong, the persona is someone else: reject it and link the persona to `personId`. */
export function linkMatchTo(project, linkId, personId, { decidedBy } = {}) {
  need(decidedBy);
  const link = currentLinks(project).find((l) => l.id === linkId);
  if (!link) throw new Error(`No current link ${linkId}`);
  let next = link.personId === personId ? project : decideLink(project, linkId, "rejected", { decidedBy, rationale: "Linked to another person" }).project;
  next = acceptPair(next, personId, link.personaId, decidedBy, "Linked from Matches");
  return { project: next };
}

/**
 * USER ACTION: create a new person from one or more personas (a proposal, or a group) and accept their links.
 * draft: { name, sex, birthYear, deathYear } (see personDraft in src/resolve/profiles.js). Returns { project, person }.
 */
export function createPersonFromPersonas(project, personaIds, draft, { decidedBy, groupId = null } = {}) {
  need(decidedBy);
  if (!personaIds?.length) throw new Error("no personas");
  const person = {
    id: `p_${crypto.randomUUID().slice(0, 8)}`, name: draft.name || "Unnamed", sex: draft.sex || "U",
    birth: draft.birthYear ? { year: draft.birthYear } : {}, death: draft.deathYear ? { year: draft.deathYear } : {},
    events: [], periods: [], groups: [], media: [], spouseIds: [],
  };
  let next = { ...project, people: [...(project.people ?? []), person] };
  for (const id of personaIds) next = acceptPair(next, person.id, id, decidedBy, "New person created from Matches");
  if (groupId) next = setGroupStatus(next, groupId, "linked");
  return { project: next, person };
}

function setGroupStatus(project, groupId, status) {
  return { ...project, matchGroups: (project.matchGroups ?? []).map((g) => (g.id === groupId ? { ...g, status, decidedAt: isoNow() } : g)) };
}

/** USER ACTION: every persona of a group is this person. */
export function linkGroupTo(project, groupId, personId, { decidedBy } = {}) {
  need(decidedBy);
  const g = (project.matchGroups ?? []).find((x) => x.id === groupId);
  if (!g) throw new Error(`No group ${groupId}`);
  let next = project;
  for (const id of g.personaIds) next = acceptPair(next, personId, id, decidedBy, "Group linked from Matches");
  return { project: setGroupStatus(next, groupId, "linked") };
}

/** USER ACTION: these are not the same person: the group closes and its pairs are never grouped again. */
export function dismissGroup(project, groupId, { decidedBy } = {}) {
  need(decidedBy);
  const g = (project.matchGroups ?? []).find((x) => x.id === groupId);
  if (!g) throw new Error(`No group ${groupId}`);
  const pairs = [];
  for (let i = 0; i < g.personaIds.length; i++) for (let j = i + 1; j < g.personaIds.length; j++) pairs.push(pairKey(g.personaIds[i], g.personaIds[j]));
  return { project: { ...setGroupStatus(project, groupId, "dismissed"), matchDismissed: [...new Set([...(project.matchDismissed ?? []), ...pairs])] } };
}

/** USER ACTION: one persona is not the same as the others of its group. */
export function removeFromGroup(project, groupId, personaId, { decidedBy } = {}) {
  need(decidedBy);
  const g = (project.matchGroups ?? []).find((x) => x.id === groupId);
  if (!g) throw new Error(`No group ${groupId}`);
  const rest = g.personaIds.filter((id) => id !== personaId);
  const pairs = rest.map((id) => pairKey(id, personaId));
  const matchDismissed = [...new Set([...(project.matchDismissed ?? []), ...pairs])];
  const matchGroups = (project.matchGroups ?? []).map((x) => (x.id !== groupId ? x : rest.length >= 2 ? { ...x, personaIds: rest, pairs: (x.pairs ?? []).filter((e) => e.a !== personaId && e.b !== personaId) } : { ...x, personaIds: rest, status: "dismissed", decidedAt: isoNow() }));
  return { project: { ...project, matchGroups, matchDismissed } };
}

/**
 * Name variant suggestions after an accept: given names or surnames written differently in the record and in the
 * tree (e.g. "Iohannes" and "Ion"). Only suggestions: a pair is added when the researcher clicks (origin "learned").
 * `known`: the name variants already in the library. Returns [{ canonical, variant }].
 */
export function variantSuggestions(personaName, personName, known = []) {
  const fold = (s) => String(s ?? "").normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^\p{L}\s]+/gu, " ").trim();
  const words = (s) => fold(String(s ?? "").replace(/\([^)]*\)/g, " ")).split(/\s+/).filter((w) => w.length >= 2);
  const a = words(personaName), b = words(personName);
  if (!a.length || !b.length) return [];
  const have = new Set(known.flatMap((v) => [`${fold(v.canonical)}|${fold(v.variant)}`, `${fold(v.variant)}|${fold(v.canonical)}`]));
  const out = [];
  const consider = (x, y, cx, cy) => { if (x && y && x !== y && !have.has(`${x}|${y}`) && !out.some((o) => fold(o.canonical) === y && fold(o.variant) === x)) out.push({ canonical: cy, variant: cx }); };
  const orig = (s) => String(s ?? "").replace(/\([^)]*\)/g, " ").trim().split(/\s+/).filter((w) => fold(w).length >= 2);
  const oa = orig(personaName), ob = orig(personName);
  consider(a[0], b[0], oa[0], ob[0]);                                                   // first given names
  if (a.length > 1 && b.length > 1) consider(a[a.length - 1], b[b.length - 1], oa[oa.length - 1], ob[ob.length - 1]);   // surnames
  return out;
}

/** The researcher's choice of weights and threshold for later runs (null = the standard ones). */
export function setMatchingWeights(project, choice) {
  const matching = { ...(project.settings?.matching ?? {}) };
  if (choice) { matching.weights = choice.weights; matching.threshold = choice.threshold; }
  else { delete matching.weights; delete matching.threshold; }
  return { ...project, settings: { ...(project.settings ?? {}), matching } };
}
