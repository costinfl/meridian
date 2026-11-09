import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { freshStorage } from "./evidenceHelpers.js";
import { createEvidenceLibrary } from "../evidence/index.js";
import { createProject, createSource, normalizeProject } from "../models/project.js";
import { SAMPLE_PEOPLE } from "../sampleData.js";
import { exportProjectZip, importProjectBundle, importProjectZip } from "../share.js";
import { convertLegacyFacts, confirmLegacyVerified } from "../conclusions/legacyFacts.js";
import { evidenceSeedsOf } from "../conclusions/evidenceSeeds.js";
import { currentLinks, addLink, decideLink } from "../conclusions/personaLinks.js";
import { exportGedcom } from "../gedcom.js";

const clone = (x) => JSON.parse(JSON.stringify(x));
const bytes = (s) => new TextEncoder().encode(s);

/** A library-backed storage with in-memory blobs (fake-indexeddb cannot hold real Blobs). */
async function makeStore() {
  const adapter = freshStorage(); await adapter._open();   // freeze this factory before another store replaces the global
  const blobs = new Map();
  const store = {
    blobs, adapter,
    saveBlob: async (k, b) => { blobs.set(k, b); }, loadBlob: async (k) => blobs.get(k) ?? null,
    getSetting: (k) => adapter.getSetting(k), putSetting: (k, v) => adapter.putSetting(k, v),
  };
  for (const m of ["dbTransact", "dbGet", "dbPut", "dbAdd", "dbGetAll", "dbGetAllByIndex", "dbGetByIndex", "dbCount"]) store[m] = (...a) => adapter[m](...a);
  store.library = createEvidenceLibrary(store);
  return store;
}
const rows = (store, name) => store.dbGetAll(name);
const ALL = ["evRepositories", "evSources", "evCopies", "evPages", "evRegions", "evRuns", "evTextLayers", "evRecords", "evPersonas", "evAssertions", "evAssertionDecisions", "evPlaces", "evPlaceNames", "evPlaceParents", "evNameVariants"];
const counts = async (store) => Object.fromEntries(await Promise.all(ALL.map(async (s) => [s, await store.dbCount(s)])));
const loadZip = async (blob) => JSZip.loadAsync(blob);

/** Project with sources (one with a file), converted legacy facts, confirmed verified facts, plus real library content. */
async function scenario(store) {
  const lib = store.library;
  const register = createSource({ title: "Registrul de botezuri", type: "document", repository: "ANPh", date: "1850", blobKey: "blob_1_reg.pdf", fileName: "reg.pdf", mimeType: "application/pdf" });
  store.blobs.set("blob_1_reg.pdf", new Blob(["register scan bytes"], { type: "application/pdf" }));
  const people = clone(SAMPLE_PEOPLE);
  people[0].events[1].sourceId = register.id;
  let project = normalizeProject(createProject("Hariton", { people, sources: [register] }));
  project = (await convertLegacyFacts({ library: lib, loadBlob: store.loadBlob, saveBlob: store.saveBlob, project })).project;
  await confirmLegacyVerified({ library: lib, project });

  // real library content on the register's copy: a page, regions (one corrected), text, a record with a place
  const libSrcId = project.sources[0].librarySourceId;
  const copy = (await lib.copies.listBySource(libSrcId))[0];
  const { page, wholePageRegion } = await lib.pages.addPage({ copyId: copy.id, pageIndex: 0, label: "f. 1", width: 100, height: 140 });
  const row = await lib.pages.addRegion({ pageId: page.id, box: { x0: 0, y0: 0.1, x1: 1, y1: 0.2 }, kind: "row" });
  const fixed = await lib.pages.correctRegion(row.id, { box: { x0: 0, y0: 0.1, x1: 1, y1: 0.25 } });
  const run = await lib.runs.startRun({ processor: "tesseract" });
  await lib.runs.addRawOutput({ data: "raw ocr output", mediaType: "text/plain" });
  await lib.textLayers.add({ regionId: fixed.id, runId: run.id, originalText: "Ştefan Hariton, născut 1850" });
  const parent = await lib.places.createPlace({ kind: "county" }); await lib.places.addName({ placeId: parent.id, name: "Județul Prahova" });
  const place = await lib.places.createPlace(); await lib.places.addName({ placeId: place.id, name: "Ploiești" });
  await lib.places.addParent({ childId: place.id, parentId: parent.id, validFrom: "1925" });
  const { record, personas } = await lib.records.createRecord({ kind: "baptism", regionIds: [fixed.id], runId: run.id, placeId: place.id, personas: [{ nameAsWritten: "Ştefan Hariton", role: "child" }, { nameAsWritten: "Dumitru Hariton", role: "father" }] });
  const a = await lib.assertions.propose({ subjectType: "persona", subjectId: personas[0].id, property: "name", originalValue: "Ştefan Hariton", runId: run.id, citation: { regionId: fixed.id } });
  await lib.assertions.confirmAssertion(a.id, { decidedBy: "researcher" });
  await lib.nameVariants.add({ canonical: "Ioan", variant: "Ion" });
  // the researcher links the baptism's child persona to a person: that is what makes the project reference this record
  const added = addLink(project, { personId: "i1", personaId: personas[0].id, method: "manual" });
  project = decideLink(added.project, added.link.id, "accepted", { decidedBy: "researcher" }).project;
  return { project, lib, libSrcId, copy, page, wholePageRegion, row, fixed, record, personas, assertion: a };
}

describe("bundle v2: evidence.json (P4.T6)", () => {
  it("a project without evidence exports exactly as before: no evidence.json", async () => {
    const store = await makeStore();
    const zip = await loadZip(await exportProjectZip(normalizeProject(createProject("Plain", { people: clone(SAMPLE_PEOPLE) })), store));
    expect(Object.keys(zip.files).filter((n) => !n.endsWith("/")).sort()).toEqual(["project.json"]);
  });

  it("round-trips a project with converted legacy facts and library content into a fresh library without loss", async () => {
    const A = await makeStore(); const s = await scenario(A);
    const zip = await loadZip(await exportProjectZip(s.project, A));
    expect(zip.file("evidence.json")).toBeTruthy();
    const data = JSON.parse(await zip.file("evidence.json").async("string"));
    expect(data).toMatchObject({ format: "meridian-evidence", version: 1 });
    expect(data.raw ?? data.rawOutputs).toBeUndefined();                 // raw outputs are not part of the bundle
    expect(data.counts.assertions).toBe((await A.dbCount("evAssertions")));
    expect(Object.keys(zip.files).some((n) => n.startsWith("media/blob_1_reg.pdf-"))).toBe(true);
    expect(Object.keys(zip.files).some((n) => /^media\/legacy_.*-legacy-meridian-data\.json$/.test(n))).toBe(true); // the legacy snapshot travels

    const B = await makeStore();
    const { project, evidence } = await importProjectBundle(await exportProjectZip(s.project, A), B);
    expect(evidence.warnings).toEqual([]);
    // every library row exists in B, equal to A's (nothing lost, nothing changed)
    for (const store of ALL) {
      const a = (await rows(A, store)).sort((x, y) => (x.id < y.id ? -1 : 1)), b = (await rows(B, store)).sort((x, y) => (x.id < y.id ? -1 : 1));
      expect(b, store).toEqual(a);
    }
    expect(await B.dbCount("evRawOutputs")).toBe(0);
    // the project's references all resolve in B
    const seeds = evidenceSeedsOf(project);
    for (const id of seeds.assertionIds) expect(await B.library.assertions.get(id), id).toBeTruthy();
    for (const id of seeds.personaIds) expect(await B.library.records.getPersona(id)).toBeTruthy();
    for (const id of seeds.sourceIds) expect(await B.library.sources.get(id)).toBeTruthy();
    expect(await B.library.copies.get(project.legacyEvidence.copyId)).toBeTruthy();
    expect(await B.library.pages.getRegion(project.legacyEvidence.regionId)).toBeTruthy();
    // statuses, decisions and the correction chain survived
    expect((await B.library.assertions.listByStatus("confirmed")).length).toBe(6);       // 5 legacy-verified + the researcher's
    expect((await B.library.assertions.get(s.assertion.id)).decidedBy).toBe("researcher");
    expect((await B.library.pages.currentRegion(s.row.id)).id).toBe(s.fixed.id);
    expect((await B.library.textLayers.current(s.fixed.id)).originalText).toBe("Ştefan Hariton, născut 1850");
    expect((await B.library.places.ancestorsAt((await B.library.places.findByName("Ploiești"))[0].id, "1930")).map((p) => p.kind)).toEqual(["county"]);
    expect(await B.library.nameVariants.expand("Ioan")).toEqual(["ioan", "ion"]);
    // files of copies travelled
    expect(B.blobs.has("blob_1_reg.pdf")).toBe(true);
    expect([...B.blobs.keys()].some((k) => k.startsWith("legacy_"))).toBe(true);
    // the timeline side is intact: people, families, links, GEDCOM
    expect(currentLinks(project)).toHaveLength(9);
    expect(project.families).toEqual(s.project.families);
    expect(exportGedcom(project.people, { sources: project.sources })).toBe(exportGedcom(s.project.people, { sources: s.project.sources }));
  });

  it("importing the same bundle again adds nothing and duplicates nothing", async () => {
    const A = await makeStore(); const s = await scenario(A);
    const blob = await exportProjectZip(s.project, A);
    const B = await makeStore();
    await importProjectBundle(blob, B);
    const before = await counts(B);
    const again = await importProjectBundle(blob, B);
    expect(Object.values(again.evidence.added).reduce((n, x) => n + x, 0)).toBe(0);
    expect(await counts(B)).toEqual(before);
  });

  it("matches a copy by content hash: its pages and regions are remapped onto the existing copy and citations follow", async () => {
    const A = await makeStore(); const s = await scenario(A);
    const blob = await exportProjectZip(s.project, A);
    // B already holds the same file under its own ids, with its own page 0 and whole-page region
    const B = await makeStore();
    const { copy: bCopy } = await B.library.copies.registerFile(new Blob(["register scan bytes"]), { fileName: "my-copy.pdf", storage: { mode: "folder", path: "Drive/reg.pdf" } });
    const bPage = await B.library.pages.addPage({ copyId: bCopy.id, pageIndex: 0, width: 100, height: 140 });
    expect(bCopy.sha256).toBe(s.copy.sha256);

    const { evidence } = await importProjectBundle(blob, B);
    expect(evidence.maps.copy[s.copy.id]).toBe(bCopy.id);
    expect(evidence.maps.page[s.page.id]).toBe(bPage.page.id);
    expect(evidence.maps.region[s.wholePageRegion.id]).toBe(bPage.wholePageRegion.id);
    expect(await B.dbCount("evCopies") ).toBe(2);   // B's register copy (reused) + the legacy snapshot copy
    expect(await B.dbCount("evPages")).toBe(2);     // register page 0 (reused) + the legacy page
    // the extra regions were attached to B's page; text, record and assertion now cite B's regions
    const regions = await B.library.pages.listRegions(bPage.page.id);
    expect(regions.map((r) => r.kind).sort()).toEqual(["page", "row", "row"]);   // whole page, original row, corrected row
    const fixedInB = regions.find((r) => r.id === s.fixed.id);
    expect(fixedInB.pageId).toBe(bPage.page.id);
    expect((await B.library.textLayers.current(s.fixed.id)).regionId).toBe(s.fixed.id);
    expect((await B.library.assertions.get(s.assertion.id)).citationRegionId).toBe(s.fixed.id);
    // no second whole-page region appeared
    expect(regions.filter((r) => r.kind === "page")).toHaveLength(1);
    expect(evidence.warnings).toEqual([]);
  });

  it("never overwrites: an existing entity with the same id keeps its content, and its decision wins", async () => {
    const A = await makeStore(); const s = await scenario(A);
    const blob = await exportProjectZip(s.project, A);
    const B = await makeStore();
    await importProjectBundle(blob, B);
    // the researcher in B changes things after the first import
    await B.library.assertions.propose({ subjectType: "persona", subjectId: s.personas[0].id, property: "occupation", originalValue: "preot", runId: (await B.library.runs.listRuns())[0].id, citation: { regionId: s.fixed.id } });
    const mine = await B.library.sources.update(s.libSrcId, { title: "My edited title" });
    await importProjectBundle(blob, B);
    expect((await B.library.sources.get(s.libSrcId)).title).toBe("My edited title");
    expect(mine.updatedAt).toBe((await B.library.sources.get(s.libSrcId)).updatedAt);
    expect((await B.library.assertions.listBySubject(s.personas[0].id)).filter((a) => a.property === "occupation")).toHaveLength(1);

    // an assertion that already exists undecided in the library is NOT decided by an incoming decision
    const data = await A.library.bundle.collect(evidenceSeedsOf(s.project));
    const C = await makeStore();
    await C.library.bundle.merge({ ...data, assertionDecisions: [] });                    // an older state: nothing decided yet
    expect((await C.library.assertions.get(s.assertion.id)).status).toBe("proposed");
    const second = await C.library.bundle.merge(data);                                   // newer data carries the decisions
    expect(second.added.assertionDecisions).toBe(0);
    expect((await C.library.assertions.get(s.assertion.id)).status).toBe("proposed");     // the library's own state wins
  });

  it("is atomic: a bundle that fails midway leaves the library untouched", async () => {
    const A = await makeStore(); const s = await scenario(A);
    const data = await A.library.bundle.collect(evidenceSeedsOf(s.project));
    const B = await makeStore();
    // a row that cannot be stored, in the LAST store merged, after everything else has been written
    const poisoned = { ...data, nameVariants: [...data.nameVariants, { id: "bad", canonicalKey: "a", variantKey: "b", unstorable() {} }] };
    await expect(B.library.bundle.merge(poisoned)).rejects.toBeTruthy();
    expect(Object.values(await counts(B)).reduce((n, x) => n + x, 0)).toBe(0);      // all or nothing
    // and the same data without the poison merges fine
    const ok = await B.library.bundle.merge(data);
    expect(ok.added.assertions).toBe(data.assertions.length);
    // a bundle that repeats a row is tolerated: the repeat is skipped
    const C = await makeStore();
    const dup = await C.library.bundle.merge({ ...data, places: [...data.places, data.places[0]] });
    expect(dup.skipped.places).toBe(1);
  });

  it("rejects malformed evidence before writing anything", async () => {
    const B = await makeStore();
    await expect(B.library.bundle.merge({ format: "other", version: 1 })).rejects.toThrow(/unknown format/);
    await expect(B.library.bundle.merge({ format: "meridian-evidence", version: 99 })).rejects.toThrow(/unsupported version/);
    await expect(B.library.bundle.merge({ format: "meridian-evidence", version: 1, assertions: "x" })).rejects.toThrow(/must be an array/);
    await expect(B.library.bundle.merge({ format: "meridian-evidence", version: 1, sources: [{ title: "no id" }] })).rejects.toThrow(/no id/);
    expect(Object.values(await counts(B)).reduce((n, x) => n + x, 0)).toBe(0);
  });

  it("old bundles (no evidence.json) still import; a bundle with evidence into a storage without a library keeps the project", async () => {
    const A = await makeStore(); const s = await scenario(A);
    const withEvidence = await exportProjectZip(s.project, A);
    const plainStorage = { saveBlob: async () => {}, loadBlob: async () => null };       // the old fake: no library
    const r = await importProjectBundle(withEvidence, plainStorage);
    expect(r.project.people).toHaveLength(8);
    expect(r.evidence).toMatchObject({ skipped: true });

    const zip = new JSZip(); zip.file("project.json", JSON.stringify({ name: "Old bundle", people: clone(SAMPLE_PEOPLE), annotations: [], eras: [], sources: [] }));
    const B = await makeStore();
    const old = await importProjectBundle(await zip.generateAsync({ type: "blob" }), B);
    expect(old.evidence).toBeNull();
    expect(old.project.families.length).toBeGreaterThan(0);        // upgraded transparently (P4.T1/T2)
    expect((await importProjectZip(withEvidence, B)).name).toBe("Hariton (imported)");
  });

  it("I9: no settings, API keys, folder handles, raw outputs or page caches appear anywhere in the bundle", async () => {
    const A = await makeStore(); const s = await scenario(A);
    await A.putSetting("llmApiKey", "sk-SECRET-KEY-123");
    await A.putSetting("documentFolderHandle", { kind: "directory", name: "HANDLE-NAME-XYZ" });
    await A.putSetting("lastBundleExportAt", "2026-11-09T00:00:00.000Z");
    await A.dbPut("evPageCache", { key: "p@1", pageId: s.page.id, blob: "CACHED-IMAGE-DATA" });
    const zip = await loadZip(await exportProjectZip(s.project, A));
    for (const name of Object.keys(zip.files).filter((n) => !n.endsWith("/") && !n.startsWith("media/"))) {
      const text = await zip.file(name).async("string");
      for (const secret of ["sk-SECRET-KEY-123", "HANDLE-NAME-XYZ", "llmApiKey", "documentFolderHandle", "lastBundleExportAt", "CACHED-IMAGE-DATA", "raw ocr output"]) {
        expect(text.includes(secret), `${name} contains ${secret}`).toBe(false);
      }
    }
    expect(Object.keys(JSON.parse(await zip.file("evidence.json").async("string"))).filter((k) => /key|secret|token|handle|setting|cache|raw/i.test(k))).toEqual([]);
  });

  it("a replaced (superseded) copy and its evidence travel together", async () => {
    const A = await makeStore(); const s = await scenario(A);
    const better = (await A.library.copies.registerFile(new Blob(["better scan"]), { sourceId: s.libSrcId, fileName: "reg.pdf", storage: { mode: "folder", path: "b/reg.pdf" } })).copy;
    expect(better.duplicateResolution).toBe("pending");           // same file name in the same source
    await A.library.copies.resolveDuplicate(better.id, "replace", { replacesCopyId: s.copy.id });
    const B = await makeStore();
    await importProjectBundle(await exportProjectZip(s.project, A), B);
    expect((await B.library.copies.get(s.copy.id)).supersededByCopyId).toBe(better.id);
    expect((await B.library.copies.get(better.id)).duplicateResolution).toBeNull();   // the decision is not carried as pending
    expect((await B.library.staleEvidenceFor(s.copy.id)).assertionIds.length).toBeGreaterThan(0);
  });
});
