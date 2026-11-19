// Where a person lived (context lanes): spans of years per place, from the places on their birth, life events,
// roles, groups and death. A place given at a point (birth, an event) holds from that year until the next such place;
// a role or group with a place holds for its own years and interrupts the others ("born in Ploiești, student in
// București 1870–1874, then Ploiești again" gives three spans). The last place holds until death (or 100 years after
// birth, or this year). Pure.
import { searchKey } from "../evidence/domain/normalize.js";

const THIS_YEAR = new Date().getFullYear();
export const placeKey = (text) => searchKey(String(text ?? "").split(",")[0]);   // "Cluj, Transilvania" groups with "Cluj"

/** @returns {{ place, key, from, to }[]} sorted by `from`, neighbouring spans of one place merged */
export function placeSpans(person, { thisYear = THIS_YEAR } = {}) {
  if (!person) return [];
  const by = person.birth?.year ?? null, dy = person.death?.year ?? null;
  const end = dy ?? (by ? Math.min(by + 100, thisYear) : thisYear);
  const points = [];
  if (by && person.birth?.place) points.push({ year: by, place: person.birth.place });
  for (const e of person.events ?? []) if (e.place && Number.isFinite(e.year)) points.push({ year: e.year, place: e.place });
  if (dy && person.death?.place) points.push({ year: dy, place: person.death.place, death: true });
  points.sort((a, b) => a.year - b.year || (a.death ? 1 : 0) - (b.death ? 1 : 0));
  // background from the points
  let spans = [];
  points.forEach((p, i) => {
    const next = points[i + 1];
    const to = p.death ? p.year : next ? next.year : Math.max(end, p.year);
    spans.push({ place: p.place, from: p.year, to });
  });
  // roles and groups with a place cut into the background
  const explicit = [...(person.periods ?? []), ...(person.groups ?? [])].filter((x) => x.place && Number.isFinite(x.start) && Number.isFinite(x.end))
    .map((x) => ({ place: x.place, from: Math.min(x.start, x.end), to: Math.max(x.start, x.end) }));
  for (const x of explicit) {
    spans = spans.flatMap((s) => {
      if (s.to <= x.from || s.from >= x.to) return [s];
      const out = [];
      if (s.from < x.from) out.push({ ...s, to: x.from });
      if (s.to > x.to) out.push({ ...s, from: x.to });
      return out;
    });
  }
  spans.push(...explicit);
  spans = spans.map((s) => ({ ...s, key: placeKey(s.place) })).filter((s) => s.key).sort((a, b) => a.from - b.from || a.to - b.to);
  // merge neighbours of the same place
  const merged = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && last.key === s.key && s.from <= last.to) last.to = Math.max(last.to, s.to);
    else merged.push({ ...s });
  }
  return merged;
}

/** The places of several people: Map key -> { key, place (first spelling), spans: [{ personId, from, to }] }. */
export function placesOfBoard(people, opts) {
  const out = new Map();
  for (const p of people.filter(Boolean)) {
    for (const s of placeSpans(p, opts)) {
      if (!out.has(s.key)) out.set(s.key, { key: s.key, place: s.place, spans: [] });
      out.get(s.key).spans.push({ personId: p.id, from: s.from, to: s.to });
    }
  }
  return out;
}
