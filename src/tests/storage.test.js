import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { IndexedDBAdapter } from "../storage/adapters/IndexedDBAdapter.js";
import { createProject } from "../models/project.js";

let adapter;

beforeEach(() => {
  // Fresh IDB instance per test — prevents state leaking between tests
  global.indexedDB = new IDBFactory();
  adapter = new IndexedDBAdapter();
});

describe("IndexedDBAdapter – listProjects", () => {
  it("returns an empty array when the store is empty", async () => {
    expect(await adapter.listProjects()).toEqual([]);
  });

  it("returns summary rows sorted by updatedAt descending", async () => {
    const older = createProject("Alpha");
    const newer = { ...createProject("Beta"), updatedAt: new Date(Date.now() + 2000).toISOString() };
    await adapter.saveProject(older);
    await adapter.saveProject(newer);

    const list = await adapter.listProjects();
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe("Beta");
    expect(list[1].name).toBe("Alpha");
  });

  it("omits full project data from summary rows", async () => {
    const p = createProject("Test", { people: [{ id: "p1" }] });
    await adapter.saveProject(p);

    const [row] = await adapter.listProjects();
    expect(row).not.toHaveProperty("people");
    expect(row).not.toHaveProperty("annotations");
    expect(row).not.toHaveProperty("settings");
  });

  it("computes personCount from the stored people array", async () => {
    const p = createProject("Test", { people: [{ id: "p1" }, { id: "p2" }, { id: "p3" }] });
    await adapter.saveProject(p);

    const [row] = await adapter.listProjects();
    expect(row.personCount).toBe(3);
  });

  it("reports personCount 0 when people is absent", async () => {
    const p = createProject("Test");
    await adapter.saveProject(p);

    const [row] = await adapter.listProjects();
    expect(row.personCount).toBe(0);
  });
});

describe("IndexedDBAdapter – saveProject / loadProject (upsert)", () => {
  it("round-trips a full project", async () => {
    const p = createProject("Test", { people: [{ id: "p1", name: "Alice" }] });
    await adapter.saveProject(p);
    expect(await adapter.loadProject(p.id)).toEqual(p);
  });

  it("upserts: saving the same id twice leaves only one record", async () => {
    const p = createProject("Original");
    await adapter.saveProject(p);
    await adapter.saveProject({ ...p, name: "Renamed" });

    const list = await adapter.listProjects();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Renamed");
  });

  it("returns undefined for an unknown id", async () => {
    expect(await adapter.loadProject("nonexistent")).toBeUndefined();
  });
});

describe("IndexedDBAdapter – deleteProject", () => {
  it("removes the project from the store", async () => {
    const p = createProject("Test");
    await adapter.saveProject(p);
    await adapter.deleteProject(p.id);
    expect(await adapter.listProjects()).toHaveLength(0);
  });

  it("is idempotent for unknown ids", async () => {
    await expect(adapter.deleteProject("ghost")).resolves.not.toThrow();
  });

  it("does not affect other projects", async () => {
    const a = createProject("A");
    const b = createProject("B");
    await adapter.saveProject(a);
    await adapter.saveProject(b);
    await adapter.deleteProject(a.id);

    const list = await adapter.listProjects();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("B");
  });
});

describe("IndexedDBAdapter – blob operations", () => {
  it("saves a Blob and retrieves a non-null value for the same key", async () => {
    // fake-indexeddb structured-clones the Blob (loses prototype), so we
    // check that something was stored rather than asserting reference equality.
    const blob = new Blob(["hello world"], { type: "text/plain" });
    blob.name = "note.txt";
    await adapter.saveBlob("key1", blob);
    const loaded = await adapter.loadBlob("key1");
    expect(loaded).not.toBeNull();
    expect(loaded).toMatchObject({ name: "note.txt" });
  });

  it("returns null for an unknown blob key", async () => {
    expect(await adapter.loadBlob("missing")).toBeNull();
  });

  it("deletes a blob", async () => {
    const blob = new Blob(["x"]);
    await adapter.saveBlob("k", blob);
    await adapter.deleteBlob("k");
    expect(await adapter.loadBlob("k")).toBeNull();
  });
});