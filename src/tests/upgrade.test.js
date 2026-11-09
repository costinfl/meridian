import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { IndexedDBAdapter, openDB } from "../storage/adapters/IndexedDBAdapter.js";
import { DB_VERSION, UPGRADES } from "../storage/upgrades/index.js";
import { createProject, createSource } from "../models/project.js";

const EXPECTED_STORES = ["blobs", "projects", "settings", "evRepositories", "evSources", "evCopies", "evPages", "evRegions", "evRuns", "evRunItems", "evRawOutputs", "evTextLayers", "evPageCache",
  "evPlaces", "evPlaceNames", "evPlaceParents", "evNameVariants", "evRecords", "evPersonas", "evAssertions", "evAssertionDecisions"];
const idbReq = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

/** Build a genuine version-1 database by hand (independent of the upgrade code). */
async function createV1Database(projects, blobs) {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open("meridian-v1", 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("projects", { keyPath: "id" });
      r.result.createObjectStore("blobs", { keyPath: "key" });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const tx = db.transaction(["projects", "blobs"], "readwrite");
  projects.forEach((p) => tx.objectStore("projects").put(p));
  blobs.forEach((b) => tx.objectStore("blobs").put(b));
  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  db.close();
}

beforeEach(() => { global.indexedDB = new IDBFactory(); });

describe("IndexedDB upgrade framework (I8)", () => {
  it("steps are strictly increasing, start at 1, and DB_VERSION is the last one", () => {
    expect(UPGRADES.map((s) => s.version)).toEqual(UPGRADES.map((_, i) => i + 1));
    expect(DB_VERSION).toBe(UPGRADES.length);
  });

  it("upgrades a version-1 database to the current version without losing projects or blobs", async () => {
    const p1 = { ...createProject("Alpha"), sources: [createSource({ title: "Register", blobKey: "blob_1_a.pdf" })] };
    const p2 = createProject("Beta");
    const blob = new Blob(["%PDF-fake"], { type: "application/pdf" });
    await createV1Database([p1, p2], [{ key: "blob_1_a.pdf", blob, mimeType: "application/pdf", fileName: "a.pdf" }]);

    const adapter = new IndexedDBAdapter();
    const list = await adapter.listProjects();
    expect(list.map((r) => r.name).sort()).toEqual(["Alpha", "Beta"]);
    expect(await adapter.loadProject(p1.id)).toEqual(p1);
    expect(await adapter.loadProject(p2.id)).toEqual(p2);
    // fake-indexeddb structured-clones Blobs and drops their prototype (see storage.test.js),
    // so check presence plus the untouched record metadata.
    expect(await adapter.loadBlob("blob_1_a.pdf")).not.toBeNull();
    const db = await adapter._open();
    const rec = await idbReq(db.transaction("blobs").objectStore("blobs").get("blob_1_a.pdf"));
    expect(rec).toMatchObject({ key: "blob_1_a.pdf", mimeType: "application/pdf", fileName: "a.pdf" });

    // the new store exists and works
    expect(await adapter.getSetting("lastBundleExportAt")).toBeUndefined();
    await adapter.putSetting("lastBundleExportAt", "2026-11-02T10:00:00.000Z");
    expect(await adapter.getSetting("lastBundleExportAt")).toBe("2026-11-02T10:00:00.000Z");
    await adapter.deleteSetting("lastBundleExportAt");
    expect(await adapter.getSetting("lastBundleExportAt")).toBeUndefined();
  });

  it("upgrades a version-2 database (with settings) to version 3 losslessly and adds the library stores with their indexes", async () => {
    // hand-made v2 database: v1 stores + settings
    const db2 = await new Promise((res, rej) => {
      const r = indexedDB.open("meridian-v1", 2);
      r.onupgradeneeded = () => {
        r.result.createObjectStore("projects", { keyPath: "id" });
        r.result.createObjectStore("blobs", { keyPath: "key" });
        r.result.createObjectStore("settings", { keyPath: "key" });
      };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const proj = createProject("Two");
    const tx = db2.transaction(["projects", "settings"], "readwrite");
    tx.objectStore("projects").put(proj);
    tx.objectStore("settings").put({ key: "lastBundleExportAt", value: "2026-11-02T10:00:00.000Z" });
    await new Promise((res) => { tx.oncomplete = res; });
    db2.close();

    const db = await openDB({ version: 3, steps: UPGRADES.slice(0, 3) }); // stop at v3: this test pins the v2 -> v3 step
    expect((await idbReq(db.transaction("projects").objectStore("projects").get(proj.id))).name).toBe("Two");
    expect((await idbReq(db.transaction("settings").objectStore("settings").get("lastBundleExportAt"))).value).toBe("2026-11-02T10:00:00.000Z");
    expect(db.version).toBe(3);
    const idx = (s) => [...db.transaction(s).objectStore(s).indexNames].sort();
    expect(idx("evCopies")).toEqual(["bySha256", "bySource"]);
    expect(idx("evPages")).toEqual(["byCopy", "byCopyIndex"]);
    expect(idx("evTextLayers")).toEqual(["byRegion", "byRun", "bySupersedes"]);
    expect(db.transaction("evCopies").objectStore("evCopies").index("bySha256").unique).toBe(true);
    db.close();
  });

  it("upgrades a version-3 database (with library data) to version 4 losslessly and adds the Layer 3 stores with their indexes", async () => {
    const db3 = await openDB({ version: 3, steps: UPGRADES.slice(0, 3) }); // frozen earlier steps
    const tx = db3.transaction(["projects", "evSources", "evCopies", "evTextLayers"], "readwrite");
    tx.objectStore("projects").put(createProject("Three"));
    tx.objectStore("evSources").put({ id: "s1", title: "Register", kind: "book" });
    tx.objectStore("evCopies").put({ id: "c1", sha256: "ab".repeat(32), sourceId: "s1" });
    tx.objectStore("evTextLayers").put({ id: "t1", regionId: "r1", runId: "run1", originalText: "Ştefan" });
    await new Promise((res) => { tx.oncomplete = res; });
    db3.close();

    const db = await openDB({ version: 4, steps: UPGRADES.slice(0, 4) }); // stop at v4: this test pins the v3 -> v4 step
    expect(db.version).toBe(4);
    expect((await idbReq(db.transaction("projects").objectStore("projects").getAll())).map((p) => p.name)).toEqual(["Three"]);
    expect((await idbReq(db.transaction("evSources").objectStore("evSources").get("s1"))).title).toBe("Register");
    expect((await idbReq(db.transaction("evCopies").objectStore("evCopies").index("bySha256").get("ab".repeat(32)))).id).toBe("c1");
    expect((await idbReq(db.transaction("evTextLayers").objectStore("evTextLayers").get("t1"))).originalText).toBe("Ştefan");
    const idx = (s) => [...db.transaction(s).objectStore(s).indexNames].sort();
    expect(idx("evRecords")).toEqual(["byEarliestDay", "byKind", "byLatestDay", "byPlace", "byRegion", "byRun"]);
    expect(idx("evAssertions")).toEqual(["byObject", "byRegion", "byRegionProperty", "byRun", "byStatus", "bySubject", "bySubjectProperty", "bySupersedes"]);
    expect(idx("evPersonas")).toEqual(["byNameKey", "byRecord", "bySurnameDm"]);
    expect(db.transaction("evRecords").objectStore("evRecords").index("byRegion").multiEntry).toBe(true);
    db.close();
  });

  it("upgrades a version-4 database to version 5: region supersession index, decision events, and moves old in-row decisions into events", async () => {
    const db4 = await openDB({ version: 4, steps: UPGRADES.slice(0, 4) });
    const row = (id, over) => ({ id, subjectType: "persona", subjectId: "p1", property: "name", originalValue: "x", normalizedValue: "x", runId: "run", citation: {}, citationRegionId: null, status: "proposed", decidedBy: null, decidedAt: null, supersedesId: null, createdAt: "2026-11-08T10:00:00.000Z", ...over });
    const tx = db4.transaction(["evAssertions", "evRegions", "projects"], "readwrite");
    const as = tx.objectStore("evAssertions");
    as.put(row("proposed-only"));
    as.put(row("decided-later-confirmed", { status: "confirmed", decidedBy: "researcher", decidedAt: "2026-11-08T11:00:00.000Z" }));
    as.put(row("decided-later-rejected", { status: "rejected", decidedBy: "researcher", decidedAt: "2026-11-08T12:00:00.000Z" }));
    as.put(row("entered-by-user", { status: "confirmed", decidedBy: "user", decidedAt: "2026-11-08T09:59:59.999Z" })); // decided at creation
    tx.objectStore("evRegions").put({ id: "r1", pageId: "pg", kind: "block", box: { x0: 0, y0: 0, x1: 1, y1: 1 } });
    tx.objectStore("projects").put(createProject("Four"));
    await new Promise((res) => { tx.oncomplete = res; });
    db4.close();

    const db = await openDB(); // current version
    expect(db.version).toBe(DB_VERSION);
    const get = (store, key) => idbReq(db.transaction(store).objectStore(store).get(key));
    expect((await get("evRegions", "r1")).id).toBe("r1");
    expect([...db.transaction("evRegions").objectStore("evRegions").indexNames]).toContain("bySupersedes");
    expect((await idbReq(db.transaction("projects").objectStore("projects").getAll())).map((p) => p.name)).toEqual(["Four"]);
    const decisions = await idbReq(db.transaction("evAssertionDecisions").objectStore("evAssertionDecisions").getAll());
    expect(decisions.map((d) => [d.assertionId, d.status, d.decidedBy]).sort()).toEqual([
      ["decided-later-confirmed", "confirmed", "researcher"], ["decided-later-rejected", "rejected", "researcher"],
    ]);
    for (const id of ["proposed-only", "decided-later-confirmed", "decided-later-rejected"]) {
      expect(await get("evAssertions", id)).toMatchObject({ status: "proposed", decidedBy: null, decidedAt: null });
    }
    expect(await get("evAssertions", "entered-by-user")).toMatchObject({ status: "confirmed", decidedBy: "user" }); // untouched
    expect(db.transaction("evAssertionDecisions").objectStore("evAssertionDecisions").index("byAssertion").unique).toBe(true);
    db.close();
  });

  it("a fresh database gets every store at the current version", async () => {
    const db = await openDB();
    expect(db.version).toBe(DB_VERSION);
    expect([...db.objectStoreNames].sort()).toEqual([...EXPECTED_STORES].sort());
    db.close();
  });

  it("reopening an up-to-date database runs no upgrade steps and keeps data", async () => {
    const adapter = new IndexedDBAdapter();
    const p = createProject("Gamma");
    await adapter.saveProject(p);
    let ran = 0;
    const spy = UPGRADES.map((s) => ({ ...s, up: (...a) => { ran++; return s.up(...a); } }));
    const db = await openDB({ steps: spy });
    db.close();
    expect(ran).toBe(0);
    expect((await new IndexedDBAdapter().loadProject(p.id)).name).toBe("Gamma");
  });

  it("a future step (v6) applies on top of the current schema and keeps existing data", async () => {
    const adapter = new IndexedDBAdapter();
    const p = createProject("Delta");
    await adapter.saveProject(p);
    await adapter.putSetting("k", { a: 1 });
    adapter._db.close();

    const v6 = { version: 6, up(db) { db.createObjectStore("evTest", { keyPath: "id" }); } };
    const db = await openDB({ version: 6, steps: [...UPGRADES, v6] });
    expect([...db.objectStoreNames].sort()).toEqual([...EXPECTED_STORES, "evTest"].sort());
    const kept = await idbReq(db.transaction("projects").objectStore("projects").get(p.id));
    expect(kept.name).toBe("Delta");
    const setting = await idbReq(db.transaction("settings").objectStore("settings").get("k"));
    expect(setting.value).toEqual({ a: 1 });
    db.close();
  });

  it("an open connection closes on versionchange so another tab's upgrade is not blocked (R1)", async () => {
    let notified = 0;
    const adapter = new IndexedDBAdapter({ onVersionChange: () => notified++ });
    await adapter.saveProject(createProject("Epsilon"));

    const v6 = { version: 6, up(db) { db.createObjectStore("evTest", { keyPath: "id" }); } };
    const db = await openDB({ version: 6, steps: [...UPGRADES, v6] }); // would hang forever if not closed
    expect(db.version).toBe(6);
    expect(notified).toBe(1);
    expect(adapter._db).toBeNull();
    db.close();
  });
});
