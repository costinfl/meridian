import { describe, it, expect } from "vitest";
import { searchLibrary } from "./searchHelpers.js";
import { buildDocuments, buildIndex, rebuildIndex, loadIndex, serialize, deserialize } from "../search/index.js";

describe("search documents (P7.T1)", () => {
  it("one document per region with text or evidence: folded text, names, D-M codes, one-hop variants, dates, metadata", async () => {
    const { library, pages, record } = await searchLibrary();
    const docs = await buildDocuments(await library.searchIndex.snapshot());
    const byId = new Map(docs.map((d) => [d.id, d]));
    const parish = byId.get(pages.p1.wholePageRegion.id);
    expect(parish).toMatchObject({ text: "stefan fiul lui iohannes hariton nascut la sahateni 1850", sourceKind: "parish-register", pageLabel: "f. 23v", hasProposed: false, names: "" });
    const deathRegion = record.record.regionIds[0];
    const death = byId.get(deathRegion);
    expect(death.names.split(" ")).toEqual(expect.arrayContaining(["sfatu", "loti", "alecsandru", "dragoiescu", "constandin", "cristescu"]));
    expect(death.dm.split(" ").length).toBeGreaterThan(5);
    expect(death).toMatchObject({ sourceTitle: "Registrul stării civile, Craiova, decese 1866", pageIndex: 31, hasProposed: true, hasConfirmed: false, regionKind: "block" });
    expect(death.earliestDay).toBe(death.latestDay);                                 // 26 March 1866, one day
    expect(death.text).toMatch(/craiova/);
    expect(docs.every((d) => d.id && typeof d.text === "string")).toBe(true);
  });

  it("variants are one hop (Ioan~Iohannes, Ioan~Ion: Iohannes gets ioan, not ion); rejected values are left out", async () => {
    const { library, record } = await searchLibrary();
    const run = await library.runs.startRun({ processor: "manual" });
    const persona = record.personas[0];
    await library.assertions.enterAsUser({ subjectType: "persona", subjectId: persona.id, property: "name", originalValue: "Iohannes Loti", runId: run.id, citation: { regionId: record.record.regionIds[0] } });
    const cristescu = (await library.assertions.listByStatus("proposed")).find((a) => a.property === "occupation");
    await library.assertions.rejectAssertion(cristescu.id, { decidedBy: "user" });
    const docs = await buildDocuments(await library.searchIndex.snapshot());
    const death = docs.find((d) => d.id === record.record.regionIds[0]);
    expect(death.variants.split(" ")).toContain("ioan");
    expect(death.variants.split(" ")).not.toContain("ion");
    expect(death.hasConfirmed).toBe(true);
    // both informants were "profesoru"; one rejected, the other still proposed: the word stays; reject both and it goes
    for (const a of (await library.assertions.listByStatus("proposed")).filter((x) => x.property === "occupation")) await library.assertions.rejectAssertion(a.id, { decidedBy: "user" });
    const after = (await buildDocuments(await library.searchIndex.snapshot())).find((d) => d.id === record.record.regionIds[0]);
    expect(after.text).not.toMatch(/profesoru/);
  });

  it("builds, serialises, stores and loads the index", async () => {
    const { library } = await searchLibrary();
    const built = await buildIndex(library);
    expect(built.docCount).toBe(3);                                                  // parish page, death page OCR, death record box
    expect(deserialize(serialize(built.index)).documentCount).toBe(3);
    expect(await loadIndex(library)).toBeNull();
    await rebuildIndex(library);
    const loaded = await loadIndex(library);
    expect(loaded.docCount).toBe(3);
    expect(loaded.index.search("Stefan").map((h) => h.pageLabel)).toEqual(["f. 23v"]);
    expect(loaded.index.search("Ștefan").length).toBe(1);
    await library.searchIndex.remove();
    expect(await loadIndex(library)).toBeNull();
  });
});
