import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { IndexedDBAdapter, openDB } from "../storage/adapters/IndexedDBAdapter.js";
import { DB_VERSION, UPGRADES } from "../storage/upgrades/index.js";
import { createProject, createSource } from "../models/project.js";

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

  it("a fresh database gets every store at the current version", async () => {
    const db = await openDB();
    expect(db.version).toBe(DB_VERSION);
    expect([...db.objectStoreNames].sort()).toEqual(["blobs", "projects", "settings"]);
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

  it("a future step (v3) applies on top of v2 and keeps existing data", async () => {
    const adapter = new IndexedDBAdapter();
    const p = createProject("Delta");
    await adapter.saveProject(p);
    await adapter.putSetting("k", { a: 1 });
    adapter._db.close();

    const v3 = { version: 3, up(db) { db.createObjectStore("evTest", { keyPath: "id" }); } };
    const db = await openDB({ version: 3, steps: [...UPGRADES, v3] });
    expect([...db.objectStoreNames].sort()).toEqual(["blobs", "evTest", "projects", "settings"]);
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

    const v3 = { version: 3, up(db) { db.createObjectStore("evTest", { keyPath: "id" }); } };
    const db = await openDB({ version: 3, steps: [...UPGRADES, v3] }); // would hang forever if not closed
    expect(db.version).toBe(3);
    expect(notified).toBe(1);
    expect(adapter._db).toBeNull();
    db.close();
  });
});
