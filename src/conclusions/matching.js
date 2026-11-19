/*
 * Matching results on the project (Phase 9). A matching run (src/resolve) computes proposals; this module puts them
 * on the project as CANDIDATE links (addLink) and open groups. Nothing here accepts anything (I6). Pairs with a
 * current link of any status, and rejected pairs, are never proposed again; a dismissed group pair is never grouped
 * again. Pure functions on the project object.
 *
 *   project.matchGroups:    [{ id, personaIds, score, usesProposed, pairs, runId, createdAt, status: "open" }]
 *   project.matchDismissed: ["personaA|personaB"]   pairs you said are not the same person
 *   project.settings.matching: { mark, prints, lastRun: { runId, at, scope, counts } , weights?, threshold? }
 */
import { addLink, currentLinkFor } from "./personaLinks.js";

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
