// Context from Wikidata (context lanes B2). The only network code of the context lanes: it sends place names,
// Wikidata item ids and years, never anything about people. Answers are cached on this device for 30 days (the
// device settings store, no database change), calls are spaced out (Wikidata limits bursts) and retried with backoff
// on 429/503. Queries were checked against the live service on 2026-11-19: dated events at a place and notable
// things founded there (local), events of a state within its years (national), the most notable wars, revolutions,
// treaties and disasters worldwide (global), and a place's country history from its P17 statements with dates.

export const SEARCH_URL = "https://www.wikidata.org/w/api.php";
export const SPARQL_URL = "https://query.wikidata.org/sparql";
export const TTL_DAYS = 30;
const HEADERS = { "Api-User-Agent": "Meridian (genealogy timeline)" };
const qidOf = (uri) => String(uri ?? "").split("/").pop();
const yearOf = (iso) => (iso ? Number(String(iso).replace(/^\+/, "").slice(0, String(iso).startsWith("-") ? 5 : 4)) : null);
// classes for the global lane: war, battle, revolution, treaty, natural disaster, epidemic, pandemic, coup, genocide, financial crisis
const GLOBAL_CLASSES = ["Q198", "Q178561", "Q10931", "Q131569", "Q8065", "Q44512", "Q12184", "Q45382", "Q41397", "Q114380"];

export class WikidataError extends Error {}

/**
 * @param {{ fetchImpl?, cache?: { get(key), set(key, value) }, now?, sleep?, gapMs? }} opts
 *   cache: async get/set of { at, value } (see settingsCache); gapMs: the least time between two calls
 */
export function createWikidata({ fetchImpl = (...a) => fetch(...a), cache = null, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), gapMs = 1100 } = {}) {
  let chain = Promise.resolve(), last = 0;
  // one call at a time, spaced out
  const queued = (fn) => {
    const run = chain.then(async () => { const wait = last + gapMs - now(); if (wait > 0) await sleep(wait); try { return await fn(); } finally { last = now(); } });
    chain = run.catch(() => {});
    return run;
  };
  async function getJson(url) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(url, { headers: { ...HEADERS, Accept: "application/sparql-results+json, application/json" } });
      if (res.ok) return res.json();
      if ((res.status === 429 || res.status === 503) && attempt < 3) {
        const retry = Number(res.headers?.get?.("Retry-After")) || 2 ** attempt * 2;
        await sleep(retry * 1000);
        continue;
      }
      throw new WikidataError(`Wikidata answered ${res.status}`);
    }
  }
  // "Refresh history": answers cached before this mark are fetched again
  let refreshedAt = null;
  const refreshMark = async () => {
    if (refreshedAt == null) refreshedAt = (cache ? (await cache.get("wd:refreshedAt"))?.value : null) ?? 0;
    return refreshedAt;
  };
  async function cached(key, fn) {
    const hit = cache ? await cache.get(key) : null;
    if (hit && now() - hit.at < TTL_DAYS * 86400000 && hit.at >= (await refreshMark())) return hit.value;
    const value = await queued(fn);
    if (cache) await cache.set(key, { at: now(), value });
    return value;
  }
  const sparql = async (query) => (await getJson(`${SPARQL_URL}?query=${encodeURIComponent(query)}&format=json`)).results.bindings;

  return {
    /** Look everything up again: cached answers older than now are fetched anew (the place matches are not touched). */
    async refresh() { refreshedAt = now(); if (cache) await cache.set("wd:refreshedAt", { at: refreshedAt, value: refreshedAt }); },
    /**
     * Notable people of a place (on demand): born there with a birth year in [from - 80, to], or died there within
     * [from, to]; most notable first, at most 15. Only the place id and years are sent.
     */
    placePeople: (qid, from, to) => cached(`wd:people:${qid}:${from}:${to}`, async () => {
      const lab = 'SERVICE wikibase:label { bd:serviceParam wikibase:language "ro,en". }';
      const born = await sparql(`SELECT ?p ?pLabel ?b ?d ?links WHERE { ?p wdt:P19 wd:${qid}; wdt:P569 ?b. FILTER(YEAR(?b) >= ${from - 80} && YEAR(?b) <= ${to})
        OPTIONAL { ?p wdt:P570 ?d } ?p wikibase:sitelinks ?links. ${lab} } ORDER BY DESC(?links) LIMIT 15`);
      const died = await sparql(`SELECT ?p ?pLabel ?b ?d ?links WHERE { ?p wdt:P20 wd:${qid}; wdt:P570 ?d. FILTER(YEAR(?d) >= ${from} && YEAR(?d) <= ${to})
        OPTIONAL { ?p wdt:P569 ?b } ?p wikibase:sitelinks ?links. ${lab} } ORDER BY DESC(?links) LIMIT 15`);
      const by = new Map();
      const add = (rows, how) => {
        for (const b of rows) {
          const id = qidOf(b.p?.value), name = b.pLabel?.value ?? "";
          if (!id || /^Q\d+$/.test(name)) continue;
          const cur = by.get(id) ?? { id: `wdp:${id}`, name, born: null, died: null, how: new Set(), links: Number(b.links?.value ?? 0), kind: "person", source: "wikidata" };
          cur.born = cur.born ?? yearOf(b.b?.value); cur.died = cur.died ?? yearOf(b.d?.value); cur.how.add(how);
          by.set(id, cur);
        }
      };
      add(born, "born"); add(died, "died");
      return [...by.values()].map((x) => ({ ...x, how: [...x.how] })).sort((a, b) => b.links - a.links).slice(0, 15);
    }),
    /** Candidate items for a place name: [{ qid, label, description, settlement, sitelinks, country }] best first. */
    searchPlace: (text) => cached(`wd:search:${String(text).toLowerCase().trim()}`, async () => {
      const found = new Map();
      for (const language of ["ro", "en"]) {
        const url = `${SEARCH_URL}?action=wbsearchentities&format=json&origin=*&type=item&limit=7&language=${language}&uselang=${language}&search=${encodeURIComponent(text)}`;
        const r = await getJson(url);
        for (const x of r.search ?? []) if (!found.has(x.id)) found.set(x.id, { qid: x.id, label: x.label ?? text, description: x.description ?? "" });
        if (found.size) break;
      }
      if (!found.size) return [];
      const rows = await sparql(`SELECT ?item ?links ?settlement ?countryLabel WHERE { VALUES ?item { ${[...found.keys()].map((q) => `wd:${q}`).join(" ")} }
        OPTIONAL { ?item wikibase:sitelinks ?links } OPTIONAL { ?item wdt:P31/wdt:P279* wd:Q486972 . BIND(true AS ?settlement) }
        OPTIONAL { ?item wdt:P17 ?country } SERVICE wikibase:label { bd:serviceParam wikibase:language "ro,en". } }`);
      for (const b of rows) {
        const f = found.get(qidOf(b.item.value));
        if (!f) continue;
        f.sitelinks = Math.max(f.sitelinks ?? 0, Number(b.links?.value ?? 0));
        f.settlement = f.settlement || !!b.settlement;
        f.country = f.country || b.countryLabel?.value || "";
      }
      return [...found.values()].sort((a, b) => (b.settlement ? 1 : 0) - (a.settlement ? 1 : 0) || (b.sitelinks ?? 0) - (a.sitelinks ?? 0));
    }),
    /** A place's states over time (P17 with start/end) and its Romanian county: { states: [{ qid, label, from, to }], county }. */
    placeHistory: (qid) => cached(`wd:history:${qid}`, async () => {
      const rows = await sparql(`SELECT ?c ?cLabel ?s ?e ?countyLabel WHERE { OPTIONAL { wd:${qid} wdt:P131* ?county. ?county wdt:P31 wd:Q1776764. }
        OPTIONAL { wd:${qid} p:P17 ?st. ?st ps:P17 ?c. OPTIONAL { ?st pq:P580 ?s } OPTIONAL { ?st pq:P582 ?e } } SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`);
      const states = [];
      for (const b of rows) if (b.c && !states.some((x) => x.qid === qidOf(b.c.value) && x.from === yearOf(b.s?.value))) {
        states.push({ qid: qidOf(b.c.value), label: b.cLabel?.value ?? "", from: yearOf(b.s?.value), to: yearOf(b.e?.value) });
      }
      states.sort((a, b) => (a.from ?? -9999) - (b.from ?? -9999));
      return { states, county: rows.find((b) => b.countyLabel)?.countyLabel?.value ?? "" };
    }),
    /** Local history: dated events at the place, and notable things founded there. */
    placeEvents: (qid, from, to) => cached(`wd:place:${qid}:${from}:${to}`, async () => {
      const ev = await sparql(`SELECT ?ev ?evLabel ?d ?end ?links WHERE { { ?ev wdt:P276 wd:${qid} } UNION { ?ev wdt:P131 wd:${qid} }
        { ?ev wdt:P585 ?d } UNION { ?ev wdt:P580 ?d } OPTIONAL { ?ev wdt:P582 ?end } FILTER(YEAR(?d) >= ${from} && YEAR(?d) <= ${to})
        FILTER NOT EXISTS { ?ev wdt:P31 wd:Q5 } ?ev wikibase:sitelinks ?links. SERVICE wikibase:label { bd:serviceParam wikibase:language "ro,en". } } ORDER BY DESC(?links) LIMIT 40`);
      const founded = await sparql(`SELECT ?ev ?evLabel ?d ?links WHERE { ?ev wdt:P131 wd:${qid}; wdt:P571 ?d. FILTER(YEAR(?d) >= ${from} && YEAR(?d) <= ${to})
        FILTER NOT EXISTS { ?ev wdt:P31 wd:Q5 } ?ev wikibase:sitelinks ?links. FILTER(?links >= 2) SERVICE wikibase:label { bd:serviceParam wikibase:language "ro,en". } } ORDER BY DESC(?links) LIMIT 20`);
      const events = toEvents(ev), ids = new Set(events.map((e) => e.id));
      return [...events, ...toEvents(founded, "founded: ").filter((e) => !ids.has(e.id))];   // an item once
    }),
    /** National history: events of a state within its years (most notable first). */
    stateEvents: (qid, from, to, { minLinks = 8 } = {}) => cached(`wd:state:${qid}:${from}:${to}`, async () => toEvents(await sparql(`SELECT ?ev ?evLabel ?d ?end ?links WHERE { hint:Query hint:optimizer "None".
        ?ev wdt:P17 wd:${qid}. ?ev wikibase:sitelinks ?links. FILTER(?links >= ${minLinks}) { ?ev wdt:P585 ?d } UNION { ?ev wdt:P580 ?d } OPTIONAL { ?ev wdt:P582 ?end }
        FILTER(YEAR(?d) >= ${from} && YEAR(?d) <= ${to}) FILTER NOT EXISTS { ?ev wdt:P31 wd:Q5 } SERVICE wikibase:label { bd:serviceParam wikibase:language "ro,en". } } ORDER BY DESC(?links) LIMIT 60`))),
    /** World history over a range: the most notable wars, revolutions, treaties, disasters, epidemics. */
    globalEvents: (from, to) => cached(`wd:global:${from}:${to}`, async () => toEvents(await sparql(`SELECT DISTINCT ?ev ?evLabel ?d ?end ?links WHERE {
        VALUES ?cls { ${GLOBAL_CLASSES.map((q) => `wd:${q}`).join(" ")} } ?ev wdt:P31 ?cls. ?ev wikibase:sitelinks ?links. FILTER(?links >= 60)
        { ?ev wdt:P585 ?d } UNION { ?ev wdt:P580 ?d } OPTIONAL { ?ev wdt:P582 ?end } FILTER(YEAR(?d) >= ${from} && YEAR(?d) <= ${to})
        SERVICE wikibase:label { bd:serviceParam wikibase:language "ro,en". } } ORDER BY DESC(?links) LIMIT 60`))),
  };
}

/** SPARQL rows to context events: one per item (its earliest date, its latest end), with its notability. */
export function toEvents(rows, prefix = "") {
  const by = new Map();
  for (const b of rows) {
    const id = qidOf(b.ev?.value);
    const year = yearOf(b.d?.value);
    if (!id || year == null || /^Q\d+$/.test(b.evLabel?.value ?? "")) continue;   // no label in ro/en: skip
    const end = yearOf(b.end?.value);
    const cur = by.get(id);
    if (!cur) by.set(id, { id: `wd:${id}`, label: `${prefix}${b.evLabel.value}`, year, end: end && end > year ? end : null, links: Number(b.links?.value ?? 0), source: "wikidata" });
    else { cur.year = Math.min(cur.year, year); if (end && end > cur.year) cur.end = Math.max(cur.end ?? 0, end); }
  }
  return [...by.values()].sort((a, b) => b.links - a.links);
}

/** A cache in the device settings store (one row per key). */
export function settingsCache(storage) {
  return {
    get: async (key) => { try { return (await storage.getSetting(key)) ?? null; } catch { return null; } },
    set: async (key, value) => { try { await storage.putSetting(key, value); } catch { /* a full store only loses the cache */ } },
  };
}
