import { describe, it, expect } from "vitest";
import { searchLibrary } from "./searchHelpers.js";
import { buildIndex, rebuildIndex, loadIndex, updateIndex, changedRegions, createSearchService } from "../search/index.js";

const QUERIES = ["stefan", "loti", "sfatu", "craiova", "profesoru", "hariton", "ioan", "iohannes", "noise", "catolica", "dragoiescu", "1850", "bucuresti", "popescu"];

/** Everything a query can observe: the stored fields per document and the hits (ids and scores) per query. */
function observe(index) {
  const docs = {};
  const ids = new Set();
  for (const q of QUERIES) for (const h of index.search(q, { prefix: true, fuzzy: 0.2 })) ids.add(h.id);
  for (const id of ids) docs[id] = index.getStoredFields(id);
  const hits = Object.fromEntries(QUERIES.map((q) => [q, index.search(q, { prefix: true, fuzzy: 0.2 }).map((h) => `${h.id}:${h.score.toFixed(6)}`)]));
  return { count: index.documentCount, docs, hits };
}

describe("incremental index updates (P7.T2, I7) — changes may land in the same millisecond as the build", () => {
  it("after additions, readings, corrections, rejections and a corrected box, the updated index equals a full rebuild", async () => {
    const { library, pages, record, runs } = await searchLibrary();
    let state = await rebuildIndex(library);

    // 1. a new page with OCR text
    const p3 = await library.pages.addPage({ copyId: (await library.copies.listCurrent())[0].id, pageIndex: 1, width: 1000, height: 1400 });
    await library.textLayers.add({ regionId: p3.wholePageRegion.id, runId: runs.ocr.id, originalText: "Ion Popescu din București" });
    // 2. a modern reading on the death page
    const r0 = await library.textLayers.startReading({ regionId: pages.p2.wholePageRegion.id });
    await library.textLayers.rewriteReading({ readingId: r0.id, text: "Act de deces … dna Șfatu Loti, catolică" });
    // 3. a confirmation, a rejection, a correction
    const proposed = await library.assertions.listByStatus("proposed");
    await library.assertions.confirmAssertion(proposed.find((a) => a.property === "name").id, { decidedBy: "user" });
    for (const a of proposed.filter((x) => x.property === "occupation")) await library.assertions.rejectAssertion(a.id, { decidedBy: "user" });
    const run = await library.runs.startRun({ processor: "manual" });
    const age = proposed.find((a) => a.property === "age" && a.originalValue === "șaizeci și doi ani");
    await library.assertions.enterAsUser({ subjectType: age.subjectType, subjectId: age.subjectId, property: "age", originalValue: "șaizeci și trei ani", normalizedValue: { value: 63, unit: "years" }, runId: run.id, citation: age.citation, supersedesId: age.id });
    // 4. the record's box corrected (the old box stays indexed: evidence still cites it)
    await library.pages.correctRegion(record.record.regionIds[0], { box: { x0: 0.05, y0: 0.1, x1: 0.95, y1: 0.7 } });

    const change = changedRegions(await library.searchIndex.snapshot(), state.seen);
    expect(change.full).toBe(false);
    expect(change.regionIds.length).toBeGreaterThanOrEqual(3);
    const r = await updateIndex(library, state);
    expect(r.full).toBe(false);
    const full = await buildIndex(library);
    expect(observe(r.state.index)).toEqual(observe(full.index));
    expect(r.state.index.search("profesoru")).toEqual([]);                         // rejected everywhere: gone
    expect(r.state.index.search("popescu").length).toBe(1);

    // the stored index was saved and reloads to the same answers
    const reloaded = await loadIndex(library);
    expect(observe(reloaded.index)).toEqual(observe(full.index));
  });

  it("a new name variant triggers a full rebuild; nothing changed means nothing to do", async () => {
    const { library } = await searchLibrary();
    const state = await rebuildIndex(library);
    expect(await updateIndex(library, state)).toMatchObject({ changed: 0, full: false });
    await library.nameVariants.add({ canonical: "Loti", variant: "Lotti" });
    const r = await updateIndex(library, state);
    expect(r.full).toBe(true);
    expect(r.state.index.search("lotti").length).toBe(1);
  });

  it("the search service loads, builds when missing, and updates", async () => {
    const { library, runs } = await searchLibrary();
    const svc = createSearchService(library);
    expect(await svc.ensure()).toMatchObject({ rebuilt: true, docCount: 3 });
    const again = createSearchService(library);
    expect(await again.ensure()).toMatchObject({ rebuilt: false, docCount: 3 });       // from the store
    const p = await library.pages.addPage({ copyId: (await library.copies.listCurrent())[0].id, pageIndex: 5, width: 10, height: 10 });
    await library.textLayers.add({ regionId: p.wholePageRegion.id, runId: runs.ocr.id, originalText: "Gheorghe" });
    expect(await again.update()).toMatchObject({ docCount: 4, full: false, changed: 1 });
  });
});
