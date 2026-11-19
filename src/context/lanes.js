// The context lanes computed from the board (context lanes B3). Pure: from the people on the board, where they lived,
// the places' states over time, the events fetched for them, the built-in sample and your own context events, it
// builds three lanes. Local: events of every place someone on the board lived in, one chip per place. National: events
// of the countries those places belonged to at the time, one chip per line of succession. Global: world events over
// the combined range. Each item has an opacity: 1 when someone on the board was there then, 0.38 when not (as today's
// lanes dim what is outside the focus person's life), 0.12 when its chip is switched off (faded, not hidden).
import { placesOfBoard } from "./residence.js";
import { statesOfPlace, statesDuring, lineOf } from "./historicalStates.js";
import { BUILTIN } from "./builtin.js";

const ROMANIAN_PLACES = new Set(BUILTIN.local.map((x) => x.chip));

export const LANES = [{ id: "local", label: "Local" }, { id: "national", label: "National" }, { id: "global", label: "Global" }];
export const OPACITY = { present: 1, absent: 0.38, off: 0.12 };
const THIS_YEAR = new Date().getFullYear();
const decadeDown = (y) => Math.floor(y / 10) * 10, decadeUp = (y) => Math.ceil((y + 1) / 10) * 10 - 1;
const firstName = (p) => String(p?.name ?? "").split(/\s+/)[0];

/** The combined range of the lifetimes on the board. */
export function boardRange(people, thisYear = THIS_YEAR) {
  const ys = people.filter(Boolean).flatMap((p) => [p.birth?.year, p.death?.year ?? (p.birth?.year ? Math.min(p.birth.year + 100, thisYear) : null)]).filter(Number.isFinite);
  return ys.length ? [Math.min(...ys), Math.max(...ys)] : null;
}

/**
 * Where each place and country chip comes from: Map chipKey -> { key, label, spans: [{ personId, from, to }], qids? }.
 * @param resolved  { [placeKey]: { qid, label } | "none" }
 * @param histories { [qid]: placeHistory } from wikidata.js
 */
export function chipsOfBoard(people, { resolved = {}, histories = {}, thisYear } = {}) {
  const places = placesOfBoard(people, { thisYear });
  const local = new Map(), national = new Map();
  for (const [key, p] of places) {
    const r = resolved[key];
    local.set(key, { key, label: r && r !== "none" ? r.label || p.place : p.place, place: p.place, qid: r && r !== "none" ? r.qid : null, spans: p.spans });
    const h = r && r !== "none" ? histories[r.qid] : null;
    // no history (offline, or not looked up yet): a place known to be Romanian counts as Romania, so the built-in
    // national events still show
    let states = statesOfPlace(h);
    if (!states.length && (ROMANIAN_PLACES.has(key) || /rom[aâ]nia/i.test(`${r?.country ?? ""} ${r?.description ?? ""}`))) states = [{ qid: "Q218", label: "Romania", from: null, to: null }];
    for (const span of p.spans) {
      for (const part of statesDuring(states, span.from, span.to)) {
        const line = lineOf(part.state);
        if (!national.has(line.key)) national.set(line.key, { key: line.key, label: line.label, spans: [], states: new Map() });
        const n = national.get(line.key);
        n.spans.push({ personId: span.personId, from: part.from, to: part.to });
        const st = n.states.get(part.state.qid) ?? { qid: part.state.qid, label: part.state.label, from: part.from, to: part.to };
        st.from = Math.min(st.from, part.from); st.to = Math.max(st.to, part.to);
        n.states.set(part.state.qid, st);
      }
    }
  }
  return { local, national };
}

/** The Wikidata lookups the board needs (deduplicated, ranges rounded to decades so the cache is reused). */
export function lookupsFor(people, { resolved = {}, histories = {}, thisYear } = {}) {
  const places = placesOfBoard(people, { thisYear });
  const unresolved = [...places.values()].filter((p) => !(p.key in resolved)).map((p) => ({ key: p.key, place: p.place }));
  const history = [], placeEvents = [], stateEvents = new Map();
  for (const [key, p] of places) {
    const r = resolved[key];
    if (!r || r === "none") continue;
    if (!histories[r.qid]) { history.push(r.qid); continue; }
    const from = decadeDown(Math.min(...p.spans.map((s) => s.from))), to = decadeUp(Math.max(...p.spans.map((s) => s.to)));
    placeEvents.push({ qid: r.qid, from, to });
    for (const span of p.spans) for (const part of statesDuring(statesOfPlace(histories[r.qid]), span.from, span.to)) {
      const k = part.state.qid;
      const cur = stateEvents.get(k) ?? { qid: k, from: part.from, to: part.to };
      cur.from = Math.min(cur.from, part.from); cur.to = Math.max(cur.to, part.to);
      stateEvents.set(k, cur);
    }
  }
  const range = boardRange(people, thisYear);
  return {
    unresolved, history, placeEvents,
    stateEvents: [...stateEvents.values()].map((s) => ({ ...s, from: decadeDown(s.from), to: decadeUp(s.to) })),
    global: range ? { from: decadeDown(range[0]), to: decadeUp(range[1]) } : null,
  };
}

const overlaps = (item, from, to) => (item.end ?? item.year) >= from && item.year <= to;
const presentIn = (spans, item) => spans.some((s) => overlaps(item, s.from, s.to));

/**
 * @param {object} a
 * @param {object[]} a.people      the people on the board (focus first)
 * @param {object} a.resolved      project.settings.contextPlaces
 * @param {object} a.histories     { qid: placeHistory }
 * @param {object} a.fetched       { place: { qid: events }, state: { qid: events }, global: events }
 * @param {object[]} a.own         project.contextEvents
 * @param {object} a.filters       project.settings.ctxFilters: { [laneId]: { [chipKey]: false } }
 * @param {string} a.source        "wikidata" | "builtin"
 * @returns {{ id, label, sub, chips: [{ key, label, people, on, count }], items: [...], empty }[]}
 */
export function buildLanes({ people, resolved = {}, histories = {}, fetched = {}, own = [], filters = {}, source = "wikidata", thisYear = THIS_YEAR }) {
  const board = people.filter(Boolean);
  const names = Object.fromEntries(board.map((p) => [p.id, firstName(p)]));
  const { local, national } = chipsOfBoard(board, { resolved, histories, thisYear });
  const range = boardRange(board, thisYear);
  const useWd = source === "wikidata";
  const lanes = [];
  const chipList = (map, laneId) => [...map.values()].map((c) => ({
    key: c.key, label: c.label, on: filters[laneId]?.[c.key] !== false,
    people: [...new Set(c.spans.map((s) => names[s.personId]).filter(Boolean))],
    title: c.states ? [...c.states.values()].sort((a, b) => a.from - b.from).map((s) => `${s.label} ${s.from}–${s.to}`).join(" · ") : c.place,
  }));
  const finish = (laneId, chips, raw, chipSpans) => {
    const on = Object.fromEntries(chips.map((c) => [c.key, c.on]));
    const seen = new Set();
    const items = [];
    for (const it of raw) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      const spans = chipSpans(it.chip);
      // your own events are never dimmed by time (you put them there); a switched-off chip fades everything on it
      const opacity = it.chip && on[it.chip] === false ? OPACITY.off : it.own || spans === null || presentIn(spans, it) ? OPACITY.present : OPACITY.absent;
      items.push({ ...it, opacity });
    }
    for (const c of chips) c.count = items.filter((x) => x.chip === c.key).length;
    return items.sort((a, b) => a.year - b.year);
  };

  // local
  {
    const chips = chipList(local, "local");
    const raw = [];
    for (const c of local.values()) {
      if (useWd && c.qid) for (const e of fetched.place?.[c.qid] ?? []) raw.push({ ...e, chip: c.key });
      for (const e of BUILTIN.local.filter((x) => x.chip === c.key)) raw.push(e);
    }
    for (const e of own.filter((x) => x.lane === "local")) raw.push({ ...e, own: true, end: e.end ?? null });
    const items = finish("local", chips, raw, (chip) => local.get(chip)?.spans ?? []);
    lanes.push({ id: "local", label: "Local", sub: chips.map((c) => c.label).join(" · "), chips, items, empty: !chips.length });
  }
  // national
  {
    const chips = chipList(national, "national");
    const raw = [];
    for (const c of national.values()) {
      if (useWd) for (const st of c.states.values()) for (const e of fetched.state?.[st.qid] ?? []) if (overlaps(e, st.from, st.to)) raw.push({ ...e, chip: c.key });
      if (c.key === "romania") for (const e of BUILTIN.national) raw.push(e);
    }
    for (const e of own.filter((x) => x.lane === "national")) raw.push({ ...e, own: true, end: e.end ?? null });
    const items = finish("national", chips, raw, (chip) => national.get(chip)?.spans ?? []);
    lanes.push({ id: "national", label: "National", sub: chips.map((c) => c.label).join(" · "), chips, items, empty: !chips.length });
  }
  // global
  {
    const raw = [...(useWd ? (fetched.global ?? []).map((e) => ({ ...e, chip: "world" })) : []), ...BUILTIN.global];
    for (const e of own.filter((x) => x.lane === "global")) raw.push({ ...e, chip: "world", own: true, end: e.end ?? null });
    const span = range ? [{ from: range[0], to: range[1] }] : null;
    const items = finish("global", [], raw.filter((e) => !range || overlaps(e, range[0] - 10, range[1] + 10) || e.own), () => span);
    lanes.push({ id: "global", label: "Global", sub: "World", chips: [], items, empty: false });
  }
  return lanes;
}
