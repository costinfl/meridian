// Blocking (P9.T1): which pairs are worth comparing. Two profiles share a block when a phonetic (Daitch–Mokotoff)
// code of their surnames matches, including one step of the name variants you paired; then pairs whose birth
// windows cannot meet (with a margin of `marginYears`) are dropped, and, if `place` is on, pairs whose places are
// known and incompatible. Two kinds of pairs:
//   persona -> person : personas not accepted for anyone, against every tree person;
//   persona <-> persona: two such personas from different records (to group records of one unknown person).
import { dmCodesOfName, searchKey } from "../evidence/domain/normalize.js";
import { YEAR_DAYS } from "./profiles.js";

export const DEFAULT_BLOCKING = { marginYears: 10, place: false };

/** Folded name -> folded names paired with it (one step only, as in search). */
export function variantKeys(nameVariants = []) {
  const m = new Map();
  const add = (a, b) => { if (!m.has(a)) m.set(a, new Set()); m.get(a).add(b); };
  for (const v of nameVariants) {
    const a = v.canonicalKey ?? searchKey(v.canonical), b = v.variantKey ?? searchKey(v.variant);
    add(a, b); add(b, a);
  }
  return m;
}

/**
 * Block keys of a profile: each DM code of its surnames (and of their paired variants), combined with the first letter
 * of each of its given names (and of their variants: Ion ~ Iohannes share "i", Constantin ~ Costandin "c"). Two people
 * named Ion Popescu and Maria Popescu are not compared; Ion and Ioan Popescu are.
 */
export function blockKeys(profile, variants = new Map()) {
  const expand = (list) => { const out = new Set(list); for (const x of list) for (const v of variants.get(x) ?? []) out.add(v); return [...out]; };
  const codes = new Set();
  for (const n of expand(profile.surnames)) for (const c of dmCodesOfName(n)) codes.add(c);
  const initials = new Set(expand(profile.given ?? []).map((g) => g[0]).filter(Boolean));
  if (!initials.size) initials.add("*");
  const out = [];
  for (const c of codes) for (const i of initials) out.push(`${c}:${i}`);
  return out;
}

export function datesCompatible(a, b, marginYears = DEFAULT_BLOCKING.marginYears) {
  if (!a || !b) return true;
  const m = marginYears * YEAR_DAYS;
  return a[0] <= b[1] + m && b[0] <= a[1] + m;
}

const tokensOf = (places) => new Set(places.flatMap((p) => searchKey(p).split(" ").filter((t) => t.length >= 3)));
/** Places: unknown on either side = compatible; same place id, a parent of the other, or a shared word = compatible. */
export function placesCompatible(a, b, placeAncestors = new Map()) {
  if (a.placeId && b.placeId) {
    if (a.placeId === b.placeId) return true;
    const up = (id) => placeAncestors.get(id) ?? new Set();
    if (up(a.placeId).has(b.placeId) || up(b.placeId).has(a.placeId)) return true;
    for (const x of up(a.placeId)) if (up(b.placeId).has(x)) return true;
  }
  if (!a.places?.length || !b.places?.length) return !(a.placeId && b.placeId);
  const ta = tokensOf(a.places);
  for (const t of tokensOf(b.places)) if (ta.has(t)) return true;
  return false;
}

/**
 * @param {Map} personas  personaProfiles(...)
 * @param {Map} persons   personProfiles(...)
 * @param {object} opts   { acceptedPersonaIds: Set, onlyPersonaIds?: Set, onlyPersonIds?: Set (incremental: a pair is kept when
 *                         its persona, or its person, is in these sets; with neither set, everything), nameVariants,
 *                         marginYears, place, placeAncestors }
 * @returns {{ personPairs: [personaId, personId][], personaPairs: [personaId, personaId][], counts }}
 */
export function blockPairs(personas, persons, opts = {}) {
  const { acceptedPersonaIds = new Set(), onlyPersonaIds = null, onlyPersonIds = null, nameVariants = [], marginYears = DEFAULT_BLOCKING.marginYears, place = DEFAULT_BLOCKING.place, placeAncestors } = opts;
  const variants = variantKeys(nameVariants);
  const pool = [...personas.values()].filter((p) => !acceptedPersonaIds.has(p.id));
  const counts = { personas: personas.size, pooled: pool.length, persons: persons.size, noSurname: 0, buckets: 0, comparedBlocks: 0, rawPairs: 0, personPairs: 0, personaPairs: 0, droppedByDate: 0, droppedByPlace: 0 };
  const buckets = new Map();   // code -> { personas: [], persons: [] }
  const put = (code, kind, id) => { if (!buckets.has(code)) buckets.set(code, { personas: [], persons: [] }); buckets.get(code)[kind].push(id); };
  for (const p of pool) {
    const keys = blockKeys(p, variants);
    if (!keys.length) { counts.noSurname++; continue; }
    for (const k of keys) put(k, "personas", p.id);
  }
  for (const q of persons.values()) for (const k of blockKeys(q, variants)) put(k, "persons", q.id);
  counts.buckets = buckets.size;

  const incremental = !!(onlyPersonaIds || onlyPersonIds);
  const wanted = (id) => !incremental || !!onlyPersonaIds?.has(id);
  const wantedPerson = (id) => !incremental || !!onlyPersonIds?.has(id);
  const seen = new Set();
  const personPairs = [], personaPairs = [];
  const keep = (a, b) => {
    counts.rawPairs++;
    if (!datesCompatible(a.birth, b.birth, marginYears)) { counts.droppedByDate++; return false; }
    if (place && !placesCompatible(a, b, placeAncestors)) { counts.droppedByPlace++; return false; }
    return true;
  };
  for (const { personas: ps, persons: qs } of buckets.values()) {
    if (ps.length) counts.comparedBlocks++;
    for (const pid of ps) {
      const a = personas.get(pid);
      for (const qid of qs) {
        if (!wanted(pid) && !wantedPerson(qid)) continue;
        const k = `${pid}>${qid}`;
        if (seen.has(k)) continue;
        seen.add(k);
        if (keep(a, persons.get(qid))) personPairs.push([pid, qid]);
      }
    }
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const [x, y] = ps[i] < ps[j] ? [ps[i], ps[j]] : [ps[j], ps[i]];
      if (!wanted(x) && !wanted(y)) continue;
      const a = personas.get(x), b = personas.get(y);
      if (a.recordId === b.recordId) continue;                // never two people of one record
      const k = `${x}=${y}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (keep(a, b)) personaPairs.push([x, y]);
    }
  }
  counts.personPairs = personPairs.length;
  counts.personaPairs = personaPairs.length;
  return { personPairs, personaPairs, counts };
}
