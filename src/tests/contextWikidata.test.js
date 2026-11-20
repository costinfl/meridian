import { describe, it, expect, vi } from "vitest";
import { createWikidata, toEvents, settingsCache, SEARCH_URL, SPARQL_URL } from "../context/wikidata.js";
import { statesOfPlace, statesDuring, regionOfCounty, lineOf, REGION_STATES } from "../context/historicalStates.js";

const uri = (q) => `http://www.wikidata.org/entity/${q}`;
const lit = (v) => ({ value: String(v) });
const json = (body, status = 200, headers = {}) => ({ ok: status < 300, status, json: async () => body, headers: { get: (k) => headers[k] ?? null } });
const memCache = () => { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } }; };

/** A stand-in for Wikidata answering by query shape. */
function fakeWikidata({ throttleFirst = false } = {}) {
  const calls = [];
  let throttled = !throttleFirst;
  const fetchImpl = async (url, init) => {
    calls.push({ url, headers: init?.headers });
    if (!throttled) { throttled = true; return json({}, 429, { "Retry-After": "1" }); }
    if (url.startsWith(SEARCH_URL)) {
      return json({ search: [{ id: "Q49280734", label: "Ploiești", description: "localitate componentă" }, { id: "Q179585", label: "Ploiești", description: "municipiu din județul Prahova, România" }] });
    }
    const q = decodeURIComponent(url.split("query=")[1]);
    if (q.includes("wd:Q486972")) {
      return json({ results: { bindings: [
        { item: lit(uri("Q49280734")), links: lit(1) },
        { item: lit(uri("Q179585")), links: lit(80), settlement: lit(true), countryLabel: lit("România") },
      ] } });
    }
    if (q.includes("p:P17")) {
      return json({ results: { bindings: [
        { c: lit(uri("Q958291")), cLabel: lit("United Principalities of Moldavia and Wallachia"), s: lit("1859-02-05T00:00:00Z"), e: lit("1881-05-22T00:00:00Z"), countyLabel: lit("Prahova County") },
        { c: lit(uri("Q389004")), cLabel: lit("Principality of Wallachia"), e: lit("1859-02-05T00:00:00Z"), countyLabel: lit("Prahova County") },
        { c: lit(uri("Q203493")), cLabel: lit("Kingdom of Romania"), s: lit("1881-05-22T00:00:00Z"), e: lit("1947-12-30T00:00:00Z") },
      ] } });
    }
    if (q.includes("wdt:P571")) return json({ results: { bindings: [{ ev: lit(uri("Q1")), evLabel: lit("Muzeul Județean"), d: lit("1867-01-01T00:00:00Z"), links: lit(2) }] } });
    if (q.includes("wdt:P276")) return json({ results: { bindings: [{ ev: lit(uri("Q2")), evLabel: lit("Bombardarea Ploieștiului"), d: lit("1943-08-01T00:00:00Z"), links: lit(9) }] } });
    return json({ results: { bindings: [] } });
  };
  return { calls, fetchImpl };
}

describe("Wikidata for the context lanes (B2)", () => {
  it("finds a place, a settlement first; only the place name is sent; a polite header; cached", async () => {
    const f = fakeWikidata();
    const cache = memCache();
    const wd = createWikidata({ fetchImpl: f.fetchImpl, cache, sleep: async () => {}, gapMs: 0 });
    const found = await wd.searchPlace("Ploiești");
    expect(found[0]).toMatchObject({ qid: "Q179585", settlement: true, country: "România", sitelinks: 80 });
    expect(f.calls[0].url).toMatch(/search=Plo/);
    expect(f.calls[0].headers["Api-User-Agent"]).toMatch(/Meridian/);
    const n = f.calls.length;
    await wd.searchPlace("Ploiești");
    expect(f.calls.length).toBe(n);                                        // from the cache
  });

  it("place history: dated states and the county; local events and foundings", async () => {
    const wd = createWikidata({ fetchImpl: fakeWikidata().fetchImpl, sleep: async () => {}, gapMs: 0 });
    const h = await wd.placeHistory("Q179585");
    expect(h.county).toBe("Prahova County");
    expect(h.states.map((s) => [s.label, s.from, s.to])).toEqual([["Principality of Wallachia", null, 1859], ["United Principalities of Moldavia and Wallachia", 1859, 1881], ["Kingdom of Romania", 1881, 1947]]);
    const ev = await wd.placeEvents("Q179585", 1840, 1950);
    expect(ev.map((e) => [e.label, e.year])).toEqual([["Bombardarea Ploieștiului", 1943], ["founded: Muzeul Județean", 1867]]);
  });

  it("refresh: answers cached before it are fetched again", async () => {
    const f = fakeWikidata();
    let t = 1000;
    const cache = memCache();
    const wd = createWikidata({ fetchImpl: f.fetchImpl, cache, now: () => t, sleep: async () => {}, gapMs: 0 });
    await wd.placeHistory("Q179585");
    const n = f.calls.length;
    t += 10; await wd.placeHistory("Q179585");
    expect(f.calls.length).toBe(n);
    t += 10; await wd.refresh();
    t += 10; await wd.placeHistory("Q179585");
    expect(f.calls.length).toBe(n + 1);
    // a new client on the same device sees the mark too
    const wd2 = createWikidata({ fetchImpl: f.fetchImpl, cache, now: () => t, sleep: async () => {}, gapMs: 0 });
    await wd2.placeHistory("Q179585");
    expect(f.calls.length).toBe(n + 1);                                    // the re-fetched answer is newer than the mark
  });

  it("notable people: born or died there, one entry each, most notable first", async () => {
    const rows = (how) => ({ results: { bindings: how === "born"
      ? [{ p: lit(uri("Q1")), pLabel: lit("Take Ionescu"), b: lit("1858-10-25T00:00:00Z"), d: lit("1922-06-21T00:00:00Z"), links: lit(20) }]
      : [{ p: lit(uri("Q1")), pLabel: lit("Take Ionescu"), b: lit("1858-10-25T00:00:00Z"), d: lit("1922-06-21T00:00:00Z"), links: lit(20) }, { p: lit(uri("Q2")), pLabel: lit("Addison Baker"), b: lit("1907-01-11T00:00:00Z"), d: lit("1943-08-01T00:00:00Z"), links: lit(7) }] } });
    const fetchImpl = async (url) => json(rows(decodeURIComponent(url).includes("wdt:P19") ? "born" : "died"));
    const wd = createWikidata({ fetchImpl, sleep: async () => {}, gapMs: 0 });
    const people = await wd.placePeople("Q179585", 1850, 1950);
    expect(people.map((p) => [p.name, p.born, p.died, p.how])).toEqual([["Take Ionescu", 1858, 1922, ["born", "died"]], ["Addison Baker", 1907, 1943, ["died"]]]);
  });

  it("backs off on 429 and retries", async () => {
    const f = fakeWikidata({ throttleFirst: true });
    const sleep = vi.fn(async () => {});
    const wd = createWikidata({ fetchImpl: f.fetchImpl, sleep, gapMs: 0 });
    expect((await wd.searchPlace("Ploiești"))[0].qid).toBe("Q179585");
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it("calls are spaced out", async () => {
    let t = 0;
    const sleep = vi.fn(async (ms) => { t += ms; });
    const wd = createWikidata({ fetchImpl: fakeWikidata().fetchImpl, sleep, now: () => t, gapMs: 1100 });
    await wd.placeHistory("Q1"); await wd.placeHistory("Q2");
    expect(sleep).toHaveBeenCalledWith(1100);
  });

  it("events: one per item, earliest date, an end only when later; unlabelled items skipped", () => {
    const rows = [
      { ev: lit(uri("Q9")), evLabel: lit("Primul Război Mondial"), d: lit("1918-11-11T00:00:00Z"), end: lit("1918-11-11T00:00:00Z"), links: lit(266) },
      { ev: lit(uri("Q9")), evLabel: lit("Primul Război Mondial"), d: lit("1914-07-28T00:00:00Z"), end: lit("1918-11-11T00:00:00Z"), links: lit(266) },
      { ev: lit(uri("Q8")), evLabel: lit("Q8"), d: lit("1900-01-01T00:00:00Z"), links: lit(3) },
    ];
    expect(toEvents(rows)).toEqual([{ id: "wd:Q9", label: "Primul Război Mondial", year: 1914, end: 1918, links: 266, source: "wikidata" }]);
  });

  it("the settings cache tolerates a failing store", async () => {
    const c = settingsCache({ getSetting: async () => { throw new Error("x"); }, putSetting: async () => { throw new Error("x"); } });
    expect(await c.get("k")).toBeNull();
    await c.set("k", 1);
  });
});

describe("Country at the time (B2)", () => {
  it("Wikidata's dated states are used as they are", () => {
    const st = statesOfPlace({ states: [{ qid: "Q389004", label: "Principality of Wallachia", from: null, to: 1859 }, { qid: "Q958291", label: "United Principalities", from: 1859, to: 1881 }, { qid: "Q203493", label: "Kingdom of Romania", from: 1881, to: 1947 }] });
    expect(statesDuring(st, 1850, 1900).map((x) => [x.state.label, x.from, x.to])).toEqual([["Principality of Wallachia", 1850, 1859], ["United Principalities", 1859, 1881], ["Kingdom of Romania", 1881, 1900]]);
  });

  it("without dates, the built-in table by county: Ploiești 1850 Wallachia, 1860 United Principalities, 1900 Romania; Cluj 1900 Austria-Hungary, 1930 Romania", () => {
    const at = (county, year) => statesDuring(statesOfPlace({ states: [{ qid: "Q218", label: "Romania", from: null, to: null }], county }), year, year)[0].state.label;
    expect([at("Prahova County", 1850), at("Prahova County", 1860), at("Prahova County", 1900)]).toEqual(["Principality of Wallachia", "United Principalities", "Kingdom of Romania"]);
    expect([at("Cluj County", 1900), at("Cluj County", 1930)]).toEqual(["Austria-Hungary", "Kingdom of Romania"]);
    expect(at("Constanța County", 1870)).toBe("Ottoman Empire");
    expect(regionOfCounty("Iași County")).toBe("moldavia");
    expect(statesOfPlace({ states: [{ qid: "Q183", label: "Germany", from: null, to: null }], county: "" })).toEqual([{ qid: "Q183", label: "Germany", from: null, to: null }]);
  });

  it("lines of succession make one chip", () => {
    expect(new Set(REGION_STATES.wallachia.map((s) => lineOf(s).key))).toEqual(new Set(["romania"]));
    expect(lineOf({ qid: "Q28513" })).toEqual({ key: "austria-hungary", label: "Austria-Hungary" });
    expect(lineOf({ qid: "Q183", label: "Germany" })).toEqual({ key: "q:Q183", label: "Germany" });
  });
});
