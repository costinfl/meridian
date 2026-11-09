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

describe("DigitalCopy: duplicates are flagged and decided by a person (keep both / replace)", () => {
  const folder = (path) => ({ mode: "folder", path });

  it("byte-identical file: the existing copy is returned and flagged as an identical duplicate", async () => {
    const first = await copies.registerFile(bytes("same"), { fileName: "a.pdf", storage: folder("a.pdf") });
    const again = await copies.registerFile(bytes("same"), { fileName: "copy of a.pdf", storage: folder("other/a.pdf") });
    expect(first.duplicate).toBeNull();
    expect(again).toMatchObject({ created: false, duplicate: { kind: "identical", of: [first.copy.id] } });
    expect(await copies.listPendingDuplicates()).toEqual([]); // nothing to decide: same bytes
  });

  it("same name in the same source with different bytes: stored as its own copy and flagged as a possible version", async () => {
    const src = await sources.create({ title: "Register", kind: "parish-register" });
    const old = await copies.registerFile(bytes("low quality scan"), { sourceId: src.id, fileName: "register-1843.pdf", storage: folder("a/register-1843.pdf") });
    const better = await copies.registerFile(bytes("better scan, 600 dpi"), { sourceId: src.id, fileName: "Register-1843.PDF", storage: folder("b/Register-1843.PDF") });
    expect(better.created).toBe(true);
    expect(better.duplicate).toEqual({ kind: "possible-version", of: [old.copy.id] });
    expect(better.copy).toMatchObject({ duplicateResolution: "pending", possibleDuplicateOf: [old.copy.id], supersededByCopyId: null });
    expect((await copies.listPendingDuplicates()).map((c) => c.id)).toEqual([better.copy.id]);
    expect(await storage.dbCount("evCopies")).toBe(2); // both exist until a person decides
    expect((await copies.get(old.copy.id)).duplicateResolution).toBeNull();
  });

  it("same folder path with changed bytes is flagged too (a file edited or re-exported in place)", async () => {
    const a = await copies.registerFile(bytes("v1"), { storage: folder("Drive/x.pdf") });
    const b = await copies.registerFile(bytes("v2"), { storage: folder("Drive/x.pdf") });
    expect(b.duplicate).toEqual({ kind: "possible-version", of: [a.copy.id] });
  });

  it("different names, or different sources, or no name are not flagged", async () => {
    const s1 = await sources.create({ title: "S1" }), s2 = await sources.create({ title: "S2" });
    await copies.registerFile(bytes("1"), { sourceId: s1.id, fileName: "scan.pdf", storage: folder("1/scan.pdf") });
    expect((await copies.registerFile(bytes("2"), { sourceId: s2.id, fileName: "scan.pdf", storage: folder("2/scan.pdf") })).duplicate).toBeNull();
    expect((await copies.registerFile(bytes("3"), { sourceId: s1.id, fileName: "other.pdf", storage: folder("3/other.pdf") })).duplicate).toBeNull();
    expect((await copies.registerFile(bytes("4"), { storage: { mode: "blob", blobKey: "k4" } })).duplicate).toBeNull();
    expect((await copies.registerFile(bytes("5"), { storage: { mode: "blob", blobKey: "k5" } })).duplicate).toBeNull();
    expect(await copies.listPendingDuplicates()).toEqual([]);
  });

  it("keep-both: both copies stay; the new one gets a distinguishing label", async () => {
    const old = (await copies.registerFile(bytes("v1"), { fileName: "reg.pdf", storage: folder("a/reg.pdf") })).copy;
    const neu = (await copies.registerFile(bytes("v2"), { fileName: "reg.pdf", storage: folder("b/reg.pdf") })).copy;
    const kept = await copies.resolveDuplicate(neu.id, "keep-both", { label: "1962 reprint" });
    expect(kept).toMatchObject({ label: "1962 reprint", duplicateResolution: "kept-both", supersededByCopyId: null });
    expect((await copies.get(old.id)).supersededByCopyId).toBeNull();
    expect((await copies.listCurrent()).map((c) => c.id).sort()).toEqual([old.id, neu.id].sort());
    expect(await copies.listPendingDuplicates()).toEqual([]);
    // default label when none is given
    const x = (await copies.registerFile(bytes("v3"), { fileName: "reg.pdf", storage: folder("c/reg.pdf") })).copy;
    expect((await copies.resolveDuplicate(x.id, "keep-both")).label).toBe("reg.pdf (2)");
  });

  it("replace: the new copy takes over, the old one is kept and marked superseded, and the source carries over", async () => {
    const src = await sources.create({ title: "Register" });
    const old = (await copies.registerFile(bytes("poor"), { sourceId: src.id, fileName: "reg.pdf", storage: folder("a/reg.pdf") })).copy;
    const neu = (await copies.registerFile(bytes("good"), { sourceId: src.id, fileName: "reg.pdf", storage: folder("b/reg.pdf") })).copy;
    const done = await copies.resolveDuplicate(neu.id, "replace");
    expect(done).toMatchObject({ duplicateResolution: "replaced", sourceId: src.id });
    const oldAfter = await copies.get(old.id);
    expect(oldAfter).toMatchObject({ supersededByCopyId: neu.id, sha256: old.sha256, storage: old.storage }); // bytes identity and location untouched
    expect((await copies.listCurrent()).map((c) => c.id)).toEqual([neu.id]);
    expect((await copies.listBySource(src.id)).map((c) => c.id).sort()).toEqual([old.id, neu.id].sort()); // history stays
    // a later file with the same name is compared with the current copy only
    const third = await copies.registerFile(bytes("best"), { sourceId: src.id, fileName: "reg.pdf", storage: folder("c/reg.pdf") });
    expect(third.duplicate.of).toEqual([neu.id]);
  });

  it("replace needs an unambiguous target; decisions are one-shot; unknown copies fail", async () => {
    const a = (await copies.registerFile(bytes("a"), { fileName: "r.pdf", storage: folder("1/r.pdf") })).copy;
    const b = (await copies.registerFile(bytes("b"), { fileName: "r.pdf", storage: { mode: "folder", path: "2/r.pdf" } })).copy;
    const c = (await copies.registerFile(bytes("c"), { fileName: "r.pdf", storage: folder("3/r.pdf") })).copy; // flagged against a and b
    expect(c.possibleDuplicateOf.sort()).toEqual([a.id, b.id].sort());
    await expect(copies.resolveDuplicate(c.id, "replace")).rejects.toMatchObject({ code: "invalid" });
    await expect(copies.resolveDuplicate(c.id, "replace", { replacesCopyId: "nope" })).rejects.toMatchObject({ code: "invalid" });
    await copies.resolveDuplicate(c.id, "replace", { replacesCopyId: b.id });
    await expect(copies.resolveDuplicate(c.id, "keep-both")).rejects.toMatchObject({ code: "conflict" });
    await expect(copies.resolveDuplicate(a.id, "keep-both")).rejects.toMatchObject({ code: "conflict" }); // never flagged
    await expect(copies.resolveDuplicate("missing", "keep-both")).rejects.toMatchObject({ code: "not-found" });
    await expect(copies.resolveDuplicate(c.id, "delete")).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("staleEvidenceFor: what was read from a copy that has been replaced", () => {
  it("lists pages, regions, text layers, records and assertions that cite the old copy", async () => {
    const { createEvidenceLibrary } = await import("../evidence/index.js");
    const lib = createEvidenceLibrary(storage);
    const src = await lib.sources.create({ title: "Register", kind: "parish-register" });
    const old = (await lib.copies.registerFile(bytes("poor"), { sourceId: src.id, fileName: "r.pdf", storage: { mode: "folder", path: "a/r.pdf" } })).copy;
    const { page, wholePageRegion } = await lib.pages.addPage({ copyId: old.id, pageIndex: 0, width: 10, height: 10 });
    const row = await lib.pages.addRegion({ pageId: page.id, box: { x0: 0, y0: 0, x1: 1, y1: 0.2 }, kind: "row" });
    const run = await lib.runs.startRun({ processor: "tesseract" });
    const text = await lib.textLayers.add({ regionId: wholePageRegion.id, runId: run.id, originalText: "Hariton?" });
    const { record, personas } = await lib.records.createRecord({ kind: "baptism", regionIds: [row.id], runId: run.id, personas: [{ nameAsWritten: "Hariton?", role: "child" }] });
    const a = await lib.assertions.propose({ subjectType: "persona", subjectId: personas[0].id, property: "name", originalValue: "Hariton?", runId: run.id, citation: { regionId: row.id } });

    const neu = (await lib.copies.registerFile(bytes("good"), { sourceId: src.id, fileName: "r.pdf", storage: { mode: "folder", path: "b/r.pdf" } })).copy;
    await lib.copies.resolveDuplicate(neu.id, "replace");

    const stale = await lib.staleEvidenceFor(old.id);
    expect(stale).toMatchObject({ supersededByCopyId: neu.id, pageIds: [page.id], textLayerIds: [text.id], recordIds: [record.id], assertionIds: [a.id] });
    expect(stale.regionIds.sort()).toEqual([wholePageRegion.id, row.id].sort());
    expect(await lib.assertions.get(a.id)).toMatchObject({ originalValue: "Hariton?" }); // not rewritten
    const fresh = await lib.staleEvidenceFor(neu.id);
    expect(fresh).toMatchObject({ supersededByCopyId: null, pageIds: [], assertionIds: [] });
    expect((await lib.staleEvidenceFor("missing")).copy).toBeUndefined();
  });
});
