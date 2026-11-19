import { useEffect, useMemo, useRef, useState } from "react";
import { buildLanes, lookupsFor } from "../context/lanes.js";
import { createWikidata, settingsCache } from "../context/wikidata.js";

// The context lanes of the board (context lanes B3): built from the people on the board, their places, Wikidata
// (looked up when the board changes, one step at a time, every answer cached on this device) and your own events.
// "Built-in only" makes no network calls at all.

let shared = null;   // one Wikidata client per page: its queue spaces all calls out
// (under the test runner there is no network: tests pass their own stand-in)
const NO_NETWORK = () => Promise.reject(new Error("no network in tests"));
export const wikidataFor = (storage) => (shared ??= createWikidata({ cache: storage?.getSetting ? settingsCache(storage) : null, ...(import.meta.env?.VITEST ? { fetchImpl: NO_NETWORK } : {}) }));

export function useContextLanes({ project, people, storage, updateProject, wikidata = null, debounceMs = 600 }) {
  const source = project?.settings?.ctxSource ?? "wikidata";
  const resolved = useMemo(() => project?.settings?.contextPlaces ?? {}, [project?.settings?.contextPlaces]);
  const [histories, setHistories] = useState({});
  const [fetched, setFetched] = useState({ place: {}, state: {}, global: [] });
  const [status, setStatus] = useState({ loading: false, error: "" });
  const done = useRef(new Set());   // lookups already made in this page session
  const board = people.filter(Boolean);
  // what the lookups depend on: the board's places and years, the place choices, the histories known
  const boardKey = JSON.stringify(board.map((p) => [p.id, p.birth, p.death, (p.events ?? []).map((e) => [e.year, e.place]), (p.periods ?? []).map((e) => [e.start, e.end, e.place]), (p.groups ?? []).map((e) => [e.start, e.end, e.place])]));

  useEffect(() => {
    if (source !== "wikidata" || !board.length) return undefined;
    let alive = true;
    const wd = wikidata ?? wikidataFor(storage);
    const fresh = (key) => !done.current.has(key);
    const made = [];   // marked done only once their results are kept (a cancelled run retries, from the cache)
    const mark = () => { for (const k of made) done.current.add(k); };
    const timer = setTimeout(async () => {
      const need = lookupsFor(board, { resolved, histories });
      const pending = [...need.unresolved.map((u) => `search:${u.key}`), ...need.history.map((q) => `history:${q}`), ...need.placeEvents.map((q) => `place:${q.qid}:${q.from}:${q.to}`),
        ...need.stateEvents.map((q) => `state:${q.qid}:${q.from}:${q.to}`), ...(need.global ? [`global:${need.global.from}:${need.global.to}`] : [])].filter(fresh);
      if (!pending.length) return;
      setStatus({ loading: true, error: "" });
      try {
        // 1. places not chosen yet: the best settlement Wikidata finds (you can change it in Places)
        const choices = {};
        for (const u of need.unresolved) {
          if (!fresh(`search:${u.key}`)) continue;
          made.push(`search:${u.key}`);
          const best = (await wd.searchPlace(u.place))[0];
          choices[u.key] = best ? { qid: best.qid, label: best.label, description: best.description, country: best.country ?? "", auto: true } : "none";
        }
        if (Object.keys(choices).length && alive) {
          mark();
          updateProject((p) => ({ ...p, settings: { ...p.settings, contextPlaces: { ...(p.settings?.contextPlaces ?? {}), ...choices } } }));
          return;   // the new choices re-run this effect
        }
        // 2. their states over time
        const hist = {};
        for (const qid of need.history) if (fresh(`history:${qid}`)) { hist[qid] = await wd.placeHistory(qid); made.push(`history:${qid}`); }
        if (Object.keys(hist).length && alive) { mark(); setHistories((h) => ({ ...h, ...hist })); return; }
        // 3. events
        const place = {}, state = {};
        for (const q of need.placeEvents) { const k = `place:${q.qid}:${q.from}:${q.to}`; if (fresh(k)) { place[q.qid] = await wd.placeEvents(q.qid, q.from, q.to); made.push(k); } }
        for (const q of need.stateEvents) { const k = `state:${q.qid}:${q.from}:${q.to}`; if (fresh(k)) { state[q.qid] = await wd.stateEvents(q.qid, q.from, q.to); made.push(k); } }
        const gk = need.global ? `global:${need.global.from}:${need.global.to}` : null;
        const global = gk && fresh(gk) ? await wd.globalEvents(need.global.from, need.global.to) : null;
        if (gk && global) made.push(gk);
        if (alive) mark();
        if (alive) setFetched((f) => ({ place: { ...f.place, ...place }, state: { ...f.state, ...state }, global: global ?? f.global }));
        if (alive) setStatus({ loading: false, error: "" });
      } catch (e) {
        if (alive) setStatus({ loading: false, error: `Wikidata could not be reached (${e.message}); showing what is cached and the built-in history.` });
      }
    }, debounceMs);
    return () => { alive = false; clearTimeout(timer); };
  }, [source, boardKey, resolved, histories]); // eslint-disable-line react-hooks/exhaustive-deps

  const lanes = useMemo(() => buildLanes({
    people: board, resolved, histories, fetched, own: project?.contextEvents ?? [], filters: project?.settings?.ctxFilters ?? {}, source,
  }), [boardKey, resolved, histories, fetched, project?.contextEvents, project?.settings?.ctxFilters, source]); // eslint-disable-line react-hooks/exhaustive-deps
  return { lanes, source, resolved, loading: status.loading, error: status.error, wikidata: source === "wikidata" ? (wikidata ?? wikidataFor(storage)) : null };
}
