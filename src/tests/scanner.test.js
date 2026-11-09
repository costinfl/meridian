import { describe, it, expect, beforeEach } from "vitest";
import { freshStorage } from "./evidenceHelpers.js";
import { fakeDirectory, fakeFile, memoryDeviceStorage, fixtureBytes } from "./ingestHelpers.js";
import { createEvidenceLibrary } from "../evidence/index.js";
import { classifyFile, isSidecar } from "../ingest/fileTypes.js";
import { parseSidecar } from "../ingest/sidecar.js";
import { linkFolder, getLinkedFolder, unlinkFolder, folderPermission, walkFolder, readFolderFile, isFolderAccessSupported, FOLDER_SETTING } from "../ingest/folder.js";
import { scanEntries, importFiles } from "../ingest/scanner.js";

let storage, library;
beforeEach(() => { storage = memoryDeviceStorage(freshStorage()); library = createEvidenceLibrary(storage); });
const walk = async (dir) => { const out = []; for await (const e of walkFolder(dir)) out.push(e); return out; };
const scan = (dir, extra) => scanEntries({ library, entries: walkFolder(dir), ...extra });

describe("file types and sidecars", () => {
  it("classifies supported and unsupported files by extension, case-insensitively", () => {
    expect(classifyFile("Registru 1843.PDF")).toMatchObject({ supported: true, kind: "pdf", mimeType: "application/pdf" });
    expect(classifyFile("nota.docx").kind).toBe("docx");
    for (const n of ["a.jpg", "a.JPEG", "a.png", "a.tif", "a.tiff"]) expect(classifyFile(n).kind).toBe("image");
    expect(classifyFile("vechi.doc")).toMatchObject({ supported: false });
    expect(classifyFile("vechi.doc").reason).toMatch(/convert to DOCX or PDF/);
    expect(classifyFile("data.xlsx").supported).toBe(false);
    expect(classifyFile("README").supported).toBe(false);
    expect(isSidecar("a.pdf.meta.json")).toBe(true);
    expect(isSidecar("a.json")).toBe(false);
  });
  it("parses sidecar metadata, ignoring unknown or mistyped fields with a warning, never throwing", () => {
    const ok = parseSidecar('{"sourceTitle":" Registrul de botezuri ","repository":"ANPh","date":"1843","pageLabel":"f. 23v","accessUrl":"https://x","kind":"parish-register","handwritten":true}');
    expect(ok.meta).toEqual({ sourceTitle: "Registrul de botezuri", repository: "ANPh", date: "1843", pageLabel: "f. 23v", accessUrl: "https://x", kind: "parish-register", handwritten: true });
    expect(ok.warnings).toEqual([]);
    const odd = parseSidecar('{"sourceTitle":5,"extra":1,"handwritten":"yes","date":""}');
    expect(odd.meta).toEqual({});
    expect(odd.warnings).toHaveLength(3);
    expect(parseSidecar("{nope").error).toMatch(/not valid JSON/);
    expect(parseSidecar("[1]").error).toMatch(/object/);
  });
});

describe("linked folder (P5.T1)", () => {
  it("remembers the picked folder in device settings only, and forgets it on unlink", async () => {
    const dir = fakeDirectory({ "a.pdf": "x" }, "Genealogie");
    const handle = await linkFolder({ storage, picker: async (opts) => { expect(opts).toEqual({ mode: "read" }); return dir; } });
    expect(handle).toBe(dir);
    const saved = await getLinkedFolder(storage);
    expect(saved).toMatchObject({ name: "Genealogie" });
    expect(saved.handle).toBe(dir);
    expect([...storage.settings.keys()]).toEqual([FOLDER_SETTING]);
    await unlinkFolder(storage);
    expect(await getLinkedFolder(storage)).toBeNull();
  });
  it("a cancelled picker leaves nothing stored", async () => {
    await expect(linkFolder({ storage, picker: async () => { throw new DOMException("cancelled", "AbortError"); } })).rejects.toThrow();
    expect(await getLinkedFolder(storage)).toBeNull();
  });
  it("re-requests permission on a new session only when asked to", async () => {
    const perm = { state: "prompt", grantOnRequest: true };
    const dir = fakeDirectory({}, "D", perm);
    expect(await folderPermission(dir)).toBe("prompt");
    expect(perm.requested).toBeUndefined();
    expect(await folderPermission(dir, { request: true })).toBe("granted");
    expect(perm.requested).toBe(1);
    expect(await folderPermission(dir, { request: true })).toBe("granted");
    expect(perm.requested).toBe(1);                                   // already granted: no second prompt
    expect(await folderPermission(fakeDirectory({}, "D", { state: "denied" }), { request: true })).toBe("denied");
    expect(await folderPermission(null)).toBe("denied");
    expect(await folderPermission({ queryPermission: async () => { throw new Error("x"); } })).toBe("denied");
  });
  it("walks sub-folders in a stable order, skips hidden entries, and reads a file by path", async () => {
    const dir = fakeDirectory({ "b.pdf": "b", ".hidden": "h", "Registre": { "1843": { "f23.jpg": "img" }, ".cache": { "x.png": "no" } }, "a.docx": "a" });
    expect((await walk(dir)).map((e) => e.path)).toEqual(["a.docx", "b.pdf", "Registre/1843/f23.jpg"]);
    expect(await (await readFolderFile(dir, "Registre/1843/f23.jpg")).text()).toBe("img");
    await expect(readFolderFile(dir, "Registre/nope.pdf")).rejects.toThrow();
  });
  it("detects support for the folder picker", () => {
    expect(isFolderAccessSupported({ showDirectoryPicker() {} })).toBe(true);
    expect(isFolderAccessSupported({})).toBe(false);
  });
});

describe("scanner (P5.T2)", () => {
  const tree = () => ({
    "text.pdf": fixtureBytes("text.pdf"), "note.docx": fixtureBytes("note.docx"),
    "Registre": { "scan.png": fixtureBytes("scan.png"), "vechi.doc": "old word", "notes.txt": "x" },
  });

  it("registers supported files as copies in the inbox, with path, name, type and content hash", async () => {
    const r = await scan(fakeDirectory(tree()));
    expect(r.scanned).toBe(3);
    expect(r.added.map((a) => a.path).sort()).toEqual(["Registre/scan.png", "note.docx", "text.pdf"]);
    expect(r.inbox).toHaveLength(3);
    expect(r.skipped.map((s) => s.path).sort()).toEqual(["Registre/notes.txt", "Registre/vechi.doc"]);
    expect(r.skipped.find((s) => s.path.endsWith(".doc")).reason).toMatch(/convert to DOCX or PDF/);
    const copy = await library.copies.get(r.added.find((a) => a.path === "Registre/scan.png").copyId);
    expect(copy).toMatchObject({ fileName: "scan.png", mimeType: "image/png", sourceId: null, storage: { mode: "folder", path: "Registre/scan.png" } });
    expect(copy.sha256).toHaveLength(64);
    expect((await library.copies.listUnassigned())).toHaveLength(3);
  });

  it("re-scanning creates no duplicates", async () => {
    const dir = fakeDirectory(tree());
    await scan(dir);
    const again = await scan(dir);
    expect(again).toMatchObject({ scanned: 3, known: 3, added: [], moved: [], flagged: [], missing: [] });
    expect(await storage.dbCount("evCopies")).toBe(3);
  });

  it("recognises a moved and renamed file by its content and updates its location", async () => {
    const first = await scan(fakeDirectory(tree()));
    const id = first.added.find((a) => a.path === "text.pdf").copyId;
    const moved = { "note.docx": fixtureBytes("note.docx"), "Arhiva": { "botezuri-1850.pdf": fixtureBytes("text.pdf") }, "Registre": { "scan.png": fixtureBytes("scan.png") } };
    const r = await scan(fakeDirectory(moved));
    expect(r.moved).toEqual([{ from: "text.pdf", to: "Arhiva/botezuri-1850.pdf", copyId: id }]);
    expect(r.added).toEqual([]);
    expect(r.missing).toEqual([]);
    expect(await library.copies.get(id)).toMatchObject({ fileName: "botezuri-1850.pdf", storage: { mode: "folder", path: "Arhiva/botezuri-1850.pdf" } });
    expect(await storage.dbCount("evCopies")).toBe(3);
  });

  it("the same content at two paths is one copy, reported; a deleted file is reported as missing and kept", async () => {
    const t = tree(); t["copie.pdf"] = fixtureBytes("text.pdf");
    const r = await scan(fakeDirectory(t));
    expect(r.added).toHaveLength(3);
    expect(r.sameContentTwice).toHaveLength(1);
    expect(await storage.dbCount("evCopies")).toBe(3);
    const again = await scan(fakeDirectory(t));
    expect(again.sameContentTwice).toHaveLength(1);
    expect(again.moved).toEqual([]);                                   // both paths exist: nothing moved
    const without = tree(); delete without["note.docx"];
    const gone = await scan(fakeDirectory(without));
    expect(gone.missing.map((m) => m.path)).toEqual(["note.docx"]);
    expect(await storage.dbCount("evCopies")).toBe(3);                 // nothing is deleted
  });

  it("a same-name file with different content is flagged for a keep-both / replace decision", async () => {
    await scan(fakeDirectory({ "reg.pdf": fixtureBytes("text.pdf") }));
    const r = await scan(fakeDirectory({ "reg.pdf": fixtureBytes("scanned.pdf") }));   // replaced in place by a different file
    expect(r.flagged).toHaveLength(1);
    expect((await library.copies.listPendingDuplicates())).toHaveLength(1);
    expect(await storage.dbCount("evCopies")).toBe(2);
  });

  it("a sidecar links the copy to a source, created once and reused; fields are applied", async () => {
    const meta = (extra = {}) => JSON.stringify({ sourceTitle: "Registrul de botezuri 1850", repository: "Arhivele Naționale Prahova", date: "1850", pageLabel: "f. 23v", accessUrl: "https://example.org/x", kind: "parish-register", handwritten: true, ...extra });
    const r = await scan(fakeDirectory({ "text.pdf": fixtureBytes("text.pdf"), "text.pdf.meta.json": meta(), "scan.png": fixtureBytes("scan.png"), "scan.png.meta.json": meta({ pageLabel: "f. 24" }), "note.docx": fixtureBytes("note.docx") }));
    expect(r.scanned).toBe(3);                                          // sidecars are not documents
    expect(r.linked).toHaveLength(2);
    expect(r.inbox.map((i) => i.path)).toEqual(["note.docx"]);
    expect(await storage.dbCount("evSources")).toBe(1);
    const source = (await library.sources.list())[0];
    expect(source).toMatchObject({ title: "Registrul de botezuri 1850", kind: "parish-register", dateText: "1850", script: "handwritten" });
    expect((await library.repositories.get(source.repositoryId)).name).toBe("Arhivele Naționale Prahova");
    const copy = await library.copies.get(r.linked[0].copyId);
    expect(copy).toMatchObject({ sourceId: source.id, accessUrl: "https://example.org/x" });
    expect(["f. 23v", "f. 24"]).toContain(copy.pageLabelHint);
    await scan(fakeDirectory({ "text.pdf": fixtureBytes("text.pdf"), "text.pdf.meta.json": meta() }));
    expect(await storage.dbCount("evSources")).toBe(1);
    expect(await storage.dbCount("evRepositories")).toBe(1);
  });

  it("a sidecar added later links a copy waiting in the inbox; a broken sidecar is a warning, not a failure", async () => {
    await scan(fakeDirectory({ "text.pdf": fixtureBytes("text.pdf") }));
    expect(await library.copies.listUnassigned()).toHaveLength(1);
    const r = await scan(fakeDirectory({ "text.pdf": fixtureBytes("text.pdf"), "text.pdf.meta.json": '{"sourceTitle":"Botezuri"}' }));
    expect(r.linked).toHaveLength(1);
    expect(await library.copies.listUnassigned()).toHaveLength(0);
    const bad = await scan(fakeDirectory({ "scan.png": fixtureBytes("scan.png"), "scan.png.meta.json": "{oops", "note.docx": fixtureBytes("note.docx"), "note.docx.meta.json": '{"colour":"red"}' }));
    expect(bad.warnings.join(" | ")).toMatch(/not valid JSON/);
    expect(bad.warnings.join(" | ")).toMatch(/unknown field colour/);
    expect(bad.added).toHaveLength(2);
  });

  it("reports progress and stops when cancelled, without a partial 'missing' report", async () => {
    const seen = [];
    const ctl = new AbortController();
    const r = await scan(fakeDirectory(tree()), { signal: ctl.signal, onProgress: (p) => { seen.push(p.done); if (p.done === 1) ctl.abort(); } });
    expect(r.cancelled).toBe(true);
    expect(r.missing).toEqual([]);
    expect(seen[0]).toBe(0);
    expect(await storage.dbCount("evCopies")).toBeLessThan(3);
    const full = await scan(fakeDirectory(tree()));                    // resuming is just scanning again
    expect(full.cancelled).toBe(false);
    expect(await storage.dbCount("evCopies")).toBe(3);
  });
});

describe("fallback: picked or dropped files are stored in the browser (P5.T1)", () => {
  it("stores the file as a blob, registers a blob-mode copy, and is idempotent", async () => {
    const files = [fakeFile("text.pdf", fixtureBytes("text.pdf"), "application/pdf"), fakeFile("vechi.doc", "x"), fakeFile("scan.png.meta.json", "{}")];
    const r = await importFiles({ library, storage, files });
    expect(r).toMatchObject({ scanned: 1, known: 0 });
    expect(r.skipped.map((s) => s.path)).toEqual(["vechi.doc"]);
    const copy = await library.copies.get(r.added[0].copyId);
    expect(copy.storage).toMatchObject({ mode: "blob" });
    expect(storage.blobs.has(copy.storage.blobKey)).toBe(true);
    const again = await importFiles({ library, storage, files });
    expect(again).toMatchObject({ scanned: 1, known: 1, added: [] });
    expect(storage.blobs.size).toBe(1);
    // the same file later found in the linked folder is the same copy
    const scanAfter = await scanEntries({ library, entries: walkFolder(fakeDirectory({ "text.pdf": fixtureBytes("text.pdf") })) });
    expect(scanAfter).toMatchObject({ known: 1, added: [] });
    expect(await storage.dbCount("evCopies")).toBe(1);
  });
});
