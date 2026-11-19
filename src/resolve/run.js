// A matching run (P9.T3), pure: profiles, blocking, comparison and scoring over the snapshot and the project's data.
// It only computes PROPOSALS; applying them (adding candidate links, groups) is done by the caller through
// src/conclusions/matching.js, which never accepts anything (I6). Pairs that already have a link of any status,
// rejected pairs and dismissed groups are left out here as well, so nothing rejected is proposed again.
import { personaProfiles, personProfiles } from "./profiles.js";
import { blockPairs, variantKeys, DEFAULT_BLOCKING } from "./blocking.js";
import { comparePair } from "./compare.js";
import { scorePair, DEFAULT_WEIGHTS, DEFAULT_THRESHOLD, MAX_CANDIDATES_PER_PERSONA } from "./score.js";
import { changedRecords } from "../graph/update.js";
import { markOf } from "../evidence/domain/snapshotMark.js";

export const RESOLVE_VERSION = "1";

/** A small stable hash of what matching knows about a person (FNV-1a), to find persons changed since the last run. */
export function personPrint(person, acceptedPersonaIds = []) {
  const s = JSON.stringify([person.name, person.displayNameChoice?.name ?? null, person.sex, person.birth?.year ?? null, person.birth?.place ?? "", person.death?.year ?? null, person.death?.place ?? "",
    person.fatherId ?? null, person.motherId ?? null, [...(person.spouseIds ?? [])].sort(), [...acceptedPersonaIds].sort()]);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

/**
 * @param {object} input
 *   snapshot, people, families, links (current links of the project), nameVariants, displayName,
 *   previous: { mark, prints } | null  (null or full = true: everything),
 *   dismissedPairs: ["a|b"], weights, threshold, blocking: { marginYears, place }, placeAncestors
 * @returns {{ proposals, groups, counts, mark, prints, scope }}
 *   proposals: [{ personaId, personId, score, signals, veto, detail, usesProposed }] best first, at most 3 per persona;
 *   groups: [{ personaIds, score, pairs: [{ a, b, score, signals }] }]
 */
export function findMatches(input) {
  const { snapshot, people = [], families = [], links = [], nameVariants = snapshot.nameVariants ?? [], displayName, previous = null, full = false,
    dismissedPairs = [], weights = DEFAULT_WEIGHTS, threshold = DEFAULT_THRESHOLD, blocking = DEFAULT_BLOCKING, placeAncestors } = input;
  const t0 = Date.now();
  const personas = personaProfiles(snapshot);
  const persons = personProfiles({ people, families, links, personaProfiles: personas, displayName });
  const acceptedPersonOf = new Map(links.filter((l) => l.status === "accepted").map((l) => [l.personaId, l.personId]));
  const acceptedOf = new Map();
  for (const l of links) if (l.status === "accepted") { if (!acceptedOf.has(l.personId)) acceptedOf.set(l.personId, []); acceptedOf.get(l.personId).push(l.personaId); }
  const prints = Object.fromEntries(people.map((p) => [p.id, personPrint(p, acceptedOf.get(p.id))]));

  // scope: everything, or personas of records changed since the last run and persons changed since then
  let onlyPersonaIds = null, onlyPersonIds = null, scope = "all";
  if (previous && !full) {
    scope = "changed";
    const recs = new Set(changedRecords(snapshot, previous.mark));
    onlyPersonaIds = new Set([...personas.values()].filter((p) => recs.has(p.recordId)).map((p) => p.id));
    onlyPersonIds = new Set(people.filter((p) => previous.prints?.[p.id] !== prints[p.id]).map((p) => p.id));
  }
  const variants = variantKeys(nameVariants);
  const { personPairs, personaPairs, counts } = blockPairs(personas, persons, {
    acceptedPersonaIds: new Set(acceptedPersonOf.keys()), onlyPersonaIds, onlyPersonIds, nameVariants, placeAncestors, ...blocking,
  });
  const ctx = { persons, personas, acceptedPersonOf, variants, placeAncestors };

  // persona -> person
  const linked = new Set(links.map((l) => `${l.personaId}>${l.personId}`));      // any current link: candidate, accepted or rejected
  const rejected = new Set(links.filter((l) => l.status === "rejected").map((l) => `${l.personaId}>${l.personId}`));
  counts.skippedLinked = 0; counts.skippedRejected = 0; counts.vetoed = 0; counts.belowThreshold = 0;
  const byPersona = new Map();
  for (const [pid, qid] of personPairs) {
    const k = `${pid}>${qid}`;
    if (rejected.has(k)) { counts.skippedRejected++; continue; }
    if (linked.has(k)) { counts.skippedLinked++; continue; }
    const c = comparePair(personas.get(pid), persons.get(qid), ctx);
    const score = scorePair(c, weights);
    if (c.veto) { counts.vetoed++; continue; }
    if (score < threshold) { counts.belowThreshold++; continue; }
    if (!byPersona.has(pid)) byPersona.set(pid, []);
    byPersona.get(pid).push({ personaId: pid, personId: qid, score, signals: c.signals, veto: null, detail: c.detail, usesProposed: personas.get(pid).usesProposed });
  }
  const proposals = [];
  for (const list of byPersona.values()) proposals.push(...list.sort((a, b) => b.score - a.score || (a.personId < b.personId ? -1 : 1)).slice(0, MAX_CANDIDATES_PER_PERSONA));
  proposals.sort((a, b) => b.score - a.score || (a.personaId < b.personaId ? -1 : 1));

  // persona <-> persona: groups of unlinked personas with no tree candidate, that look like one person
  const hasCandidate = new Set([...proposals.map((p) => p.personaId), ...links.filter((l) => l.status === "candidate").map((l) => l.personaId)]);
  const dismissed = new Set(dismissedPairs);
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const strong = [];
  counts.groupPairs = 0;
  for (const [a, b] of personaPairs) {
    if (hasCandidate.has(a) || hasCandidate.has(b) || dismissed.has(`${a}|${b}`)) continue;
    const c = comparePair(personas.get(a), personas.get(b), ctx);
    const score = scorePair(c, weights);
    if (c.veto || score < threshold) continue;
    strong.push({ a, b, score, signals: c.signals });
    for (const x of [a, b]) if (!parent.has(x)) parent.set(x, x);
    parent.set(find(a), find(b));
  }
  counts.groupPairs = strong.length;
  const groupsByRoot = new Map();
  for (const e of strong) {
    const r = find(e.a);
    if (!groupsByRoot.has(r)) groupsByRoot.set(r, { personaIds: new Set(), pairs: [] });
    const g = groupsByRoot.get(r);
    g.personaIds.add(e.a); g.personaIds.add(e.b); g.pairs.push(e);
  }
  const groups = [...groupsByRoot.values()].map((g) => ({
    personaIds: [...g.personaIds].sort(),
    score: Math.round((g.pairs.reduce((s, p) => s + p.score, 0) / g.pairs.length) * 1000) / 1000,
    usesProposed: [...g.personaIds].some((id) => personas.get(id).usesProposed),
    pairs: g.pairs,
  })).sort((x, y) => y.score - x.score);

  counts.proposed = proposals.length;
  counts.groups = groups.length;
  counts.ms = Date.now() - t0;
  return { proposals, groups, counts, mark: markOf(snapshot), prints, scope, parameters: { weights, threshold, blocking, version: RESOLVE_VERSION } };
}
