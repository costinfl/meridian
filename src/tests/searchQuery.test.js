import { describe, it, expect } from "vitest";
import { searchLibrary } from "./searchHelpers.js";
import { createSearchService, expandQuery, snippetOf } from "../search/index.js";
import { variantMap } from "../search/documents.js";

async function setup() {
  const ctx = await searchLibrary();
  const { library, copies, runs } = ctx;
  // more pages: comma-below spelling, a sound-alike surname, a dated record with a place in a hierarchy
  const add = async (copy, i, text) => {
    const p = await library.pages.addPage({ copyId: copy.id, pageIndex: i, width: 1000, height: 1400 });
    await library.textLayers.add({ regionId: p.wholePageRegion.id, runId: runs.ocr.id, originalText: text });
    return p;
  };
  await add(copies.c1, 1, "Ștefan Popesku, nășit de Ion");
  const p3 = await add(copies.c1, 2, "Maria fiica lui Gheorghe");
  const county = await library.places.createPlace({ kind: "county" }); await library.places.addName({ placeId: county.id, name: "Județul Prahova" });
  const town = await library.places.createPlace(); await library.places.addName({ placeId: town.id, name: "Ploiești" });
  await library.places.addParent({ childId: town.id, parentId: county.id });
  const run = await library.runs.startRun({ processor: "manual" });
  const box = await library.pages.addRegion({ pageId: p3.page.id, parentRegionId: p3.wholePageRegion.id, box: { x0: 0, y0: 0, x1: 1, y1: 0.3 }, kind: "block" });
  const { fuzzyDate } = await import("../evidence/index.js");
  const { record, personas } = await library.records.createRecord({ kind: "baptism", regionIds: [box.id], runId: run.id, placeId: town.id, event: fuzzyDate({ year: 1850, month: 3, day: 12, calendar: "julian" }), personas: [{ nameAsWritten: "Maria Ionescu", role: "child" }] });
  await library.assertions.enterAsUser({ subjectType: "persona", subjectId: personas[0].id, property: "name", originalValue: "Maria Ionescu", runId: run.id, citation: { regionId: box.id } });
  const svc = createSearchService(library);
  await svc.ensure();
  const q = async (text, filters = {}) => (await svc.query({ q: text, ...filters })).hits;
  return { ...ctx, svc, q, county, town, baptism: record };
}

describe("search queries (P7.T3)", () => {
  it("'Stefan' finds Ştefan (cedilla) and Ștefan (comma below); 'Loti' finds Șfatu Loti", async () => {
    const { q } = await setup();
    const stefan = await q("Stefan");
    expect(stefan.map((h) => h.snippet.filter((s) => s.hit).map((s) => s.text)[0]).sort()).toEqual(["Ştefan", "Ștefan"]);
    const loti = await q("Loti");
    expect(loti.length).toBeGreaterThanOrEqual(1);
    expect(loti[0].shownNames).toContain("Șfatu Loti");
    expect(loti[0].reasons).toContain("name");
    expect(loti[0].hasProposed).toBe(true);
  });

  it("'Ioan' finds Iohannes through the variant pair, and only one hop (not Ion's pair partners)", async () => {
    const { q } = await setup();
    const hits = await q("Ioan");
    const iohannes = hits.find((h) => h.pageLabel === "f. 23v");
    expect(iohannes.reasons).toContain("variant of “ioan”");
    // Ion~Ioan and Ioan~Iohannes: searching "Iohannes" reaches Ioan, but not Ion
    expect(expandQuery("Iohannes", variantMap([{ canonicalKey: "ioan", variantKey: "iohannes" }, { canonicalKey: "ioan", variantKey: "ion" }])).expansions[0].variants).toEqual(["ioan"]);
  });

  it("Daitch-Mokotoff finds names that sound alike but are spelt too differently for fuzzy matching", async () => {
    const { q, record } = await setup();
    const szvet = await q("Szvet");                                                    // Sfatu and Szvet share D-M code 473000
    const hit = szvet.find((h) => h.id === record.record.regionIds[0]);
    expect(hit.reasons).toContain("sounds like “szvet”");
    expect(hit.shownNames).toContain("Șfatu Loti");
  });

  it("OCR noise: a misspelt word still finds the page (fuzzy), and every word must match", async () => {
    const { q } = await setup();
    expect((await q("Haritun")).map((h) => h.pageLabel)).toContain("f. 23v");
    expect(await q("Hariton Craiova")).toEqual([]);                                  // AND across words
  });

  it("filters: years, place (and places below it), source kind, scope, confirmed only; rejected values are never found", async () => {
    const { q, library, sources } = await setup();
    expect((await q("Maria", { fromYear: 1849, toYear: 1851 })).map((h) => h.shownNames)).toEqual([["Maria Ionescu"]]);
    expect(await q("Maria", { fromYear: 1900, toYear: 1950 })).toEqual([]);
    expect((await q("Maria", { place: "Ploiești" })).length).toBe(1);
    expect((await q("Maria", { place: "Județul Prahova" })).length).toBe(1);        // the county contains the town
    expect((await q("Maria", { place: "Atlantis" }))).toEqual([]);
    expect((await q("Craiova", { sourceKinds: ["parish-register"] }))).toEqual([]);
    expect((await q("Craiova", { sourceKinds: ["civil-register"] })).length).toBeGreaterThan(0);
    expect((await q("Craiova", { sourceIds: [sources.reg.id] }))).toEqual([]);
    expect((await q("Craiova", { sourceIds: [sources.civ.id] })).length).toBeGreaterThan(0);
    expect((await q("Loti", { confirmedOnly: true }))).toEqual([]);                  // still only proposed
    expect((await q("Maria", { confirmedOnly: true })).length).toBe(1);

    for (const a of (await library.assertions.listByStatus("proposed")).filter((x) => x.property === "occupation")) await library.assertions.rejectAssertion(a.id, { decidedBy: "user" });
    const svc = createSearchService(library); await svc.update();
    expect((await svc.query({ q: "profesoru" })).hits).toEqual([]);
  });

  it("snippets keep the original spelling around the first match", () => {
    expect(snippetOf("Anulu una mie optu sute șaizeci și șase, D-ei Șfatu Loti Catolică", ["loti"], { radius: 2 })).toEqual([
      { text: "…", hit: false }, { text: "D-ei", hit: false }, { text: " ", hit: false },
      { text: "Șfatu", hit: false }, { text: " ", hit: false }, { text: "Loti", hit: true }, { text: " ", hit: false }, { text: "Catolică", hit: false },
    ]);
    expect(snippetOf("", ["x"])).toEqual([]);
  });
});
