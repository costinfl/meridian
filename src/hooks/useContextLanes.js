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
    const timer = setTimeout(async () => {
      const need = lookupsFor(board, { resolved, histories });
      const pending = [...need.unresolved.map((u) => `search:${u.key}`), ...need.history.map((q) => `history:${q}`), ...need.placeEvents.map((q) => `place:${q.qid}:${q.from}:${q.to}`),
        ...need.stateEvents.map((q) => `state:${q.qid}:${q.from}:${q.to}`), ...(need.global ? [`global:${need.global.from}:${need.global.to}`] : [])].filter(fresh);
      if (!pending.length) return;
      setStatus({ loading: true, error: "", done: 0, total: pending.length });
      let failed = 0, count = 0;
      // one lookup at a time; each answer shows as soon as it arrives; a failed lookup (Wikidata busy) does not stop
      // the others and is tried again next time (from the cache, if it arrived meanwhile)
      const step = async (key, fn, apply) => {
        if (!alive || !fresh(key)) return;
        try { const v = await fn(); if (!alive) return; done.current.add(key); apply(v); }
        catch { failed++; }
        count++;
        if (alive) setStatus((st) => ({ ...st, done: count }));
      };
      // 1. places not chosen yet: the best settlement Wikidata finds (you can change it in Places)
      const choices = {};
      for (const u of need.unresolved) {
        await step(`search:${u.key}`, () => wd.searchPlace(u.place), (found) => {
          const best = found[0];
          choices[u.key] = best ? { qid: best.qid, label: best.label, description: best.description, country: best.country ?? "", auto: true } : "none";
        });
      }
      if (Object.keys(choices).length && alive) {
        updateProject((p) => ({ ...p, settings: { ...p.settings, contextPlaces: { ...(p.settings?.contextPlaces ?? {}), ...choices } } }));
        return;   // the new choices re-run this effect
      }
      // 2. their states over time
      const hist = {};
      for (const qid of need.history) await step(`history:${qid}`, () => wd.placeHistory(qid), (h) => { hist[qid] = h; });
      if (Object.keys(hist).length && alive) { setHistories((h) => ({ ...h, ...hist })); return; }
      // 3. events, each shown as it comes
      const put = (kind, qid) => (events) => setFetched((f) => ({ ...f, [kind]: { ...f[kind], [qid]: events } }));
      for (const q of need.placeEvents) await step(`place:${q.qid}:${q.from}:${q.to}`, () => wd.placeEvents(q.qid, q.from, q.to), put("place", q.qid));
      if (need.global) await step(`global:${need.global.from}:${need.global.to}`, () => wd.globalEvents(need.global.from, need.global.to), (g) => setFetched((f) => ({ ...f, global: g })));
      // today's Romania (Q218) has so many items that its query is the slowest: it comes last
      const states = [...need.stateEvents].sort((a, b) => (a.qid === "Q218") - (b.qid === "Q218"));
      for (const q of states) await step(`state:${q.qid}:${q.from}:${q.to}`, () => wd.stateEvents(q.qid, q.from, q.to), put("state", q.qid));
      if (alive) setStatus({ loading: false, error: failed ? `Wikidata did not answer ${failed} lookup${failed === 1 ? "" : "s"} (busy or offline); they are tried again next time. Showing what arrived, the cache and the built-in history.` : "", done: count, total: pending.length });
    }, debounceMs);
    return () => { alive = false; clearTimeout(timer); };
  }, [source, boardKey, resolved, histories]); // eslint-disable-line react-hooks/exhaustive-deps

  const lanes = useMemo(() => buildLanes({
    people: board, resolved, histories, fetched, own: project?.contextEvents ?? [], filters: project?.settings?.ctxFilters ?? {}, source,
  }), [boardKey, resolved, histories, fetched, project?.contextEvents, project?.settings?.ctxFilters, source]); // eslint-disable-line react-hooks/exhaustive-deps
  return { lanes, source, resolved, loading: status.loading, error: status.error, progress: status.loading ? { done: status.done ?? 0, total: status.total ?? 0 } : null, wikidata: source === "wikidata" ? (wikidata ?? wikidataFor(storage)) : null };
}
