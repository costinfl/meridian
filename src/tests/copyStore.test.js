import { describe, it, expect, beforeEach } from "vitest";
import { freshStorage } from "./evidenceHelpers.js";
import { createCopyStore } from "../evidence/repositories/copyStore.js";
import { createSourceStore } from "../evidence/repositories/sourceStore.js";
import { sha256Hex, isSha256Hex } from "../evidence/domain/hash.js";

let storage, copies, sources;
beforeEach(() => { storage = freshStorage(); copies = createCopyStore(storage); sources = createSourceStore(storage); });

const bytes = (s) => new TextEncoder().encode(s);
const EMPTY_SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("sha256Hex", () => {
  it("matches known vectors for typed arrays, ArrayBuffers and Blobs", async () => {
    expect(await sha256Hex(bytes(""))).toBe(EMPTY_SHA);
    expect(await sha256Hex(bytes("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(await sha256Hex(bytes("abc").buffer)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(await sha256Hex(new Blob(["abc"]))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(isSha256Hex(EMPTY_SHA)).toBe(true);
    expect(isSha256Hex("ABC")).toBe(false);
  });
  it("rejects unsupported input", async () => {
    await expect(sha256Hex("a string")).rejects.toThrow(TypeError);
  });
});

describe("DigitalCopy store", () => {
  const blobLoc = (k = "blob_1_a.pdf") => ({ mode: "blob", blobKey: k });

  it("registers a file by content hash and reads it back", async () => {
    const { copy, created } = await copies.registerFile(bytes("register page"), { fileName: "a.pdf", mimeType: "application/pdf", pageCount: 3, storage: blobLoc() });
    expect(created).toBe(true);
    expect(copy.sha256).toHaveLength(64);
    expect(copy.sourceId).toBeNull();
    expect(await copies.get(copy.id)).toEqual(copy);
    expect((await copies.findBySha256(copy.sha256)).id).toBe(copy.id);
  });

  it("registering the same bytes again returns the existing copy, not a duplicate (even under another name or location)", async () => {
    const first = await copies.registerFile(bytes("same"), { fileName: "one.pdf", storage: blobLoc("k1") });
    const second = await copies.registerFile(bytes("same"), { fileName: "renamed.pdf", storage: { mode: "folder", path: "Drive/moved/one.pdf" } });
    expect(second.created).toBe(false);
    expect(second.copy.id).toBe(first.copy.id);
    expect(second.copy.fileName).toBe("one.pdf"); // first registration wins; relocate() is explicit
    expect(await storage.dbCount("evCopies")).toBe(1);
    const other = await copies.registerFile(bytes("different"), { storage: blobLoc("k2") });
    expect(other.created).toBe(true);
    expect(await storage.dbCount("evCopies")).toBe(2);
  });

  it("a duplicate registered concurrently still yields one row", async () => {
    const meta = { storage: blobLoc("k") };
    const results = await Promise.all([1, 2, 3].map(() => copies.registerFile(bytes("race"), meta)));
    expect(new Set(results.map((r) => r.copy.id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await storage.dbCount("evCopies")).toBe(1);
  });

  it("validates hash and storage location", async () => {
    await expect(copies.register({ sha256: "xyz", storage: blobLoc() })).rejects.toMatchObject({ code: "invalid" });
    await expect(copies.registerFile(bytes("a"), { storage: { mode: "blob" } })).rejects.toMatchObject({ code: "invalid" });
    await expect(copies.registerFile(bytes("a"), { storage: { mode: "folder", path: "/etc/passwd" } })).rejects.toMatchObject({ code: "invalid" });
    await expect(copies.registerFile(bytes("a"), { storage: { mode: "folder", path: "a/../../b" } })).rejects.toMatchObject({ code: "invalid" });
    await expect(copies.registerFile(bytes("a"), { storage: { mode: "cloud", path: "x" } })).rejects.toMatchObject({ code: "invalid" });
    await expect(copies.registerFile(bytes("a"), { sourceId: "missing", storage: blobLoc() })).rejects.toMatchObject({ code: "not-found" });
    expect(await storage.dbCount("evCopies")).toBe(0);
  });

  it("links a copy to a source, lists by source, and tracks the unassigned inbox", async () => {
    const src = await sources.create({ title: "Register", kind: "parish-register" });
    const a = (await copies.registerFile(bytes("a"), { storage: blobLoc("ka") })).copy;
    const b = (await copies.registerFile(bytes("b"), { sourceId: src.id, storage: blobLoc("kb") })).copy;
    expect((await copies.listUnassigned()).map((c) => c.id)).toEqual([a.id]);
    await copies.update(a.id, { sourceId: src.id, pageCount: 12 });
    expect(await copies.listUnassigned()).toEqual([]);
    expect((await copies.listBySource(src.id)).map((c) => c.id).sort()).toEqual([a.id, b.id].sort());
    await expect(copies.update(a.id, { sourceId: "missing" })).rejects.toMatchObject({ code: "not-found" });
  });

  it("relocate changes where the bytes live but keeps identity; hash and id cannot be edited", async () => {
    const c = (await copies.registerFile(bytes("moving"), { storage: { mode: "folder", path: "old/x.pdf" } })).copy;
    const moved = await copies.relocate(c.id, { mode: "folder", path: "new/x.pdf" });
    expect(moved).toMatchObject({ id: c.id, sha256: c.sha256, storage: { mode: "folder", path: "new/x.pdf" } });
    const edited = await copies.update(c.id, { sha256: "0".repeat(64), id: "other", fileName: "y.pdf" });
    expect(edited).toMatchObject({ id: c.id, sha256: c.sha256, fileName: "y.pdf" });
    await expect(copies.relocate("missing", blobLoc())).rejects.toMatchObject({ code: "not-found" });
  });
});
