import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { IndexedDBAdapter } from "../storage/adapters/IndexedDBAdapter.js";

let a;
beforeEach(() => { global.indexedDB = new IDBFactory(); a = new IndexedDBAdapter(); });

describe("generic db* store methods", () => {
  it("dbAdd inserts, dbGet reads, dbAdd of an existing key is rejected (append-only building block)", async () => {
    await a.dbAdd("evRepositories", { id: "r1", name: "Arhivele" });
    expect(await a.dbGet("evRepositories", "r1")).toEqual({ id: "r1", name: "Arhivele" });
    await expect(a.dbAdd("evRepositories", { id: "r1", name: "changed" })).rejects.toBeTruthy();
    expect((await a.dbGet("evRepositories", "r1")).name).toBe("Arhivele");
  });

  it("dbPut overwrites; dbGetAll and dbCount see the rows", async () => {
    await a.dbPut("evRepositories", { id: "r1", name: "A" });
    await a.dbPut("evRepositories", { id: "r1", name: "B" });
    await a.dbPut("evRepositories", { id: "r2", name: "C" });
    expect((await a.dbGetAll("evRepositories")).map((r) => r.name).sort()).toEqual(["B", "C"]);
    expect(await a.dbCount("evRepositories")).toBe(2);
  });

  it("dbGetAllByIndex / dbGetByIndex query by index; a unique index rejects duplicates", async () => {
    await a.dbAdd("evCopies", { id: "c1", sha256: "aa", sourceId: "s1" });
    await a.dbAdd("evCopies", { id: "c2", sha256: "bb", sourceId: "s1" });
    await a.dbAdd("evCopies", { id: "c3", sha256: "cc", sourceId: "s2" });
    expect((await a.dbGetAllByIndex("evCopies", "bySource", "s1")).map((c) => c.id).sort()).toEqual(["c1", "c2"]);
    expect((await a.dbGetByIndex("evCopies", "bySha256", "cc")).id).toBe("c3");
    await expect(a.dbAdd("evCopies", { id: "c4", sha256: "aa", sourceId: "s3" })).rejects.toBeTruthy();
  });

  it("dbTransact commits several stores atomically and rolls everything back when the callback throws", async () => {
    await a.dbTransact(["evRepositories", "evSources"], "readwrite", async (o) => {
      await o.add("evRepositories", { id: "r1" });
      await o.add("evSources", { id: "s1", repositoryId: "r1" });
    });
    expect(await a.dbCount("evSources")).toBe(1);

    await expect(a.dbTransact(["evRepositories", "evSources"], "readwrite", async (o) => {
      await o.add("evRepositories", { id: "r2" });
      throw new Error("boom");
    })).rejects.toThrow("boom");
    expect(await a.dbGet("evRepositories", "r2")).toBeUndefined();

    // a failing add inside a transaction also undoes the earlier writes
    await expect(a.dbTransact(["evRepositories", "evSources"], "readwrite", async (o) => {
      await o.add("evRepositories", { id: "r3" });
      await o.add("evSources", { id: "s1" }); // duplicate key
    })).rejects.toBeTruthy();
    expect(await a.dbGet("evRepositories", "r3")).toBeUndefined();
  });
});
