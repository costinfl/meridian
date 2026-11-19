// Comparators (P9.T2). Each signal is a value from 0 to 1, or null when it cannot be computed: missing data never
// counts against a pair. A veto (impossible pair: different sex, present after the person's death or before their
// birth) makes the pair score 0. Works for persona -> person and persona <-> persona pairs (same profile fields).
import { YEAR_DAYS } from "./profiles.js";
import { dmCodesOfName } from "../evidence/domain/normalize.js";

/** Jaro–Winkler similarity of two strings (0..1). */
export function jaroWinkler(a, b) {
  if (a === b) return a.length ? 1 : 0;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array(a.length).fill(false), bm = new Array(b.length).fill(false);
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++) {
      if (bm[j] || a[i] !== b[j]) continue;
      am[i] = bm[j] = true; m++; break;
    }
  }
  if (!m) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!am[i]) continue;
    while (!bm[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (m / a.length + m / b.length + (m - t / 2) / m) / 3;
  let l = 0;
  while (l < 4 && l < a.length && l < b.length && a[l] === b[l]) l++;
  return jaro + l * 0.1 * (1 - jaro);
}

const sameDm = (a, b) => { const x = new Set(dmCodesOfName(a)); return dmCodesOfName(b).some((c) => x.has(c)); };
const paired = (variants, a, b) => !!variants?.get(a)?.has(b);

/** Best similarity between two lists of folded name tokens: equal or paired variants 1, else Jaro–Winkler, with a floor of 0.85 when they sound alike (DM). */
export function nameSimilarity(as, bs, variants) {
  if (!as?.length || !bs?.length) return null;
  let best = 0;
  for (const a of as) for (const b of bs) {
    let v = a === b || paired(variants, a, b) ? 1 : jaroWinkler(a, b);
    if (v < 0.85 && sameDm(a, b)) v = 0.85;
    if (v > best) best = v;
  }
  return Math.round(best * 1000) / 1000;
}

export function compareGiven(p, q, variants) { return nameSimilarity(p.given, q.given, variants); }

/**
 * Surnames. A borrowed surname (a child's from the father, a wife's from the husband) or a woman's surname (it
 * changes at marriage) that does not match is unknown, not a mismatch.
 */
export function compareSurname(p, q, variants) {
  const v = nameSimilarity(p.surnames, q.surnames, variants);
  if (v == null) return null;
  if (v < 0.8 && (p.surnameFrom || q.surnameFrom || p.sex === "F" || q.sex === "F")) return null;
  return v;
}

const distYears = (a, b) => Math.max(0, a[0] - b[1], b[0] - a[1]) / YEAR_DAYS;
const widthYears = (r) => (r[1] - r[0]) / YEAR_DAYS;

/**
 * Dates. Veto when one side is present (alive) at an event after the other's death or before their birth (one year
 * of slack). Otherwise birth windows: overlapping narrow windows count most; a wide role window (e.g. "a godparent,
 * 14 to 90") overlaps almost anyone and counts little; windows apart lose value with the gap. Deaths likewise.
 */
export function compareDates(p, q) {
  const slack = YEAR_DAYS;
  for (const [x, y] of [[p, q], [q, p]]) {
    if (x.alive && y.death && x.alive[0] > y.death[1] + slack) return { value: 0, veto: "named alive after the death" };
    if (x.alive && y.birth && y.birth[1] - y.birth[0] < 5 * YEAR_DAYS && x.alive[1] < y.birth[0] - slack) return { value: 0, veto: "named before the birth" };
  }
  const parts = [];
  if (p.birth && q.birth) {
    const gap = distYears(p.birth, q.birth);
    const w = Math.max(widthYears(p.birth), widthYears(q.birth));
    parts.push(gap === 0 ? 1 - 0.5 * Math.min(1, w / 60) : Math.max(0, 0.5 * (1 - gap / 10)));
  }
  if (p.death && q.death) {
    const gap = distYears(p.death, q.death);
    parts.push(gap === 0 ? 1 : Math.max(0, 1 - gap / 5));
  }
  if (!parts.length) return { value: null, veto: null };
  return { value: Math.round((parts.reduce((s, x) => s + x, 0) / parts.length) * 1000) / 1000, veto: null };
}

export function compareSex(p, q) {
  if (!p.sex || !q.sex) return { value: null, veto: null };
  return p.sex === q.sex ? { value: 1, veto: null } : { value: 0, veto: "different sex" };
}

/** Places: 1 when the same place (or one inside the other, or a shared word), 0.3 when both are known and differ, else unknown. */
export function comparePlaces(p, q, placeAncestors = new Map()) {
  if (p.placeId && q.placeId) {
    if (p.placeId === q.placeId) return 1;
    const up = (id) => placeAncestors.get(id) ?? new Set();
    if (up(p.placeId).has(q.placeId) || up(q.placeId).has(p.placeId)) return 1;
  }
  if (!p.places?.length || !q.places?.length) return null;
  const words = (ps) => new Set(ps.flatMap((x) => x.toLowerCase().normalize("NFD").replace(/\p{M}+/gu, "").split(/[^\p{L}]+/u).filter((t) => t.length >= 3)));
  const a = words(p.places);
  for (const t of words(q.places)) if (a.has(t)) return 1;
  return 0.3;
}

const MATCHING_RELATION = { father: ["father", "parent"], mother: ["mother", "parent"], parent: ["father", "mother", "parent"], spouse: ["spouse"], child: ["child"] };

/** A profile's relatives as [{ relation, given, surnames, personId }], for a persona (from its record) or a person (from families). */
export function relativesOf(profile, ctx) {
  if (profile.relatives) {
    return profile.relatives.map((r) => ({ relation: r.relation, given: r.given, surnames: r.surnames, personId: ctx.acceptedPersonOf?.get(r.personaId) ?? null }));
  }
  const out = [];
  const add = (relation, id) => { const x = ctx.persons?.get(id); if (x) out.push({ relation, given: x.given, surnames: x.surnames, personId: id }); };
  for (const id of profile.parents ?? []) { const x = ctx.persons?.get(id); add(x?.sex === "F" ? "mother" : x?.sex === "M" ? "father" : "parent", id); }
  for (const id of profile.spouses ?? []) add("spouse", id);
  for (const id of profile.children ?? []) add("child", id);
  return out;
}

/**
 * Relatives: for each relative named on one side (father, mother, spouse, child), the best match among the other
 * side's relatives of the same kind; the mean over the relatives that could be compared. The same linked person on
 * both sides counts 1. Returns { value, matches: [{ relation, a, b, value }] }.
 */
export function compareRelatives(p, q, ctx = {}) {
  const ra = relativesOf(p, ctx), rb = relativesOf(q, ctx);
  const matches = [];
  for (const a of ra) {
    const options = rb.filter((b) => MATCHING_RELATION[a.relation]?.includes(b.relation));
    if (!options.length) continue;
    let best = null;
    for (const b of options) {
      let v;
      if (a.personId && b.personId) v = a.personId === b.personId ? 1 : 0;
      else {
        const g = nameSimilarity(a.given, b.given, ctx.variants);
        const s = nameSimilarity(a.surnames, b.surnames, ctx.variants);
        const parts = [g, a.relation === "mother" || a.relation === "spouse" ? (s != null && s >= 0.8 ? s : null) : s].filter((x) => x != null);
        v = parts.length ? parts.reduce((x, y) => x + y, 0) / parts.length : null;
      }
      if (v != null && (!best || v > best.value)) best = { relation: a.relation, a: [...a.given, ...a.surnames].join(" "), b: [...b.given, ...b.surnames].join(" "), value: Math.round(v * 1000) / 1000 };
    }
    if (best) matches.push(best);
  }
  if (!matches.length) return { value: null, matches };
  return { value: Math.round((matches.reduce((s, m) => s + m.value, 0) / matches.length) * 1000) / 1000, matches };
}

/** The persons around a profile: for a persona, the persons the other people of its record are accepted as; for a person, their family and the persons around their accepted personas. */
export function associatesOf(profile, ctx) {
  const out = new Set();
  if (profile.recordId) {
    for (const o of profile.others ?? []) { const pid = ctx.acceptedPersonOf?.get(o); if (pid) out.add(pid); }
    return out;
  }
  for (const id of [...(profile.parents ?? []), ...(profile.spouses ?? []), ...(profile.children ?? [])]) out.add(id);
  for (const pid of profile.linkedPersonaIds ?? []) {
    for (const o of ctx.personas?.get(pid)?.others ?? []) { const x = ctx.acceptedPersonOf?.get(o); if (x && x !== profile.id) out.add(x); }
  }
  return out;
}

/** FAN overlap: 1 when someone around one side is someone around the other (shared persons listed); unknown otherwise. */
export function compareFan(p, q, ctx = {}) {
  const a = associatesOf(p, ctx), b = associatesOf(q, ctx);
  const shared = [...a].filter((x) => b.has(x));
  return { value: shared.length ? 1 : null, shared };
}

/**
 * All signals for a pair. ctx: { persons, personas, acceptedPersonOf: Map personaId -> personId, variants, placeAncestors }.
 * @returns {{ signals: { given, surname, date, sex, place, relatives, fan }, veto: string|null, detail }}
 */
export function comparePair(p, q, ctx = {}) {
  const date = compareDates(p, q), sex = compareSex(p, q);
  const relatives = compareRelatives(p, q, ctx), fan = compareFan(p, q, ctx);
  return {
    signals: {
      given: compareGiven(p, q, ctx.variants), surname: compareSurname(p, q, ctx.variants), date: date.value, sex: sex.value,
      place: comparePlaces(p, q, ctx.placeAncestors), relatives: relatives.value, fan: fan.value,
    },
    veto: sex.veto ?? date.veto ?? null,
    detail: { relatives: relatives.matches, fanShared: fan.shared },
  };
}
