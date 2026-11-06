import { describe, it, expect, beforeEach } from "vitest";
import { freshStorage } from "./evidenceHelpers.js";
import { createEvidenceLibrary } from "../evidence/index.js";
import { createProject, createSource } from "../models/project.js";
import { linkProjectSourceToLibrary } from "../conclusions/linkLegacySource.js";
import { SAMPLE_PEOPLE } from "../sampleData.js";

let storage, library, blobs, loadBlob;
beforeEach(() => {
  storage = freshStorage(); library = createEvidenceLibrary(storage);
  blobs = new Map(); loadBlob = async (k) => blobs.get(k) ?? null;
});

describe("linkProjectSourceToLibrary (P2.T7)", () => {
  it("creates a library source, repository and digital copy for a document with an attached file", async () => {
    blobs.set("blob_1_register.pdf", new Blob(["%PDF register bytes"], { type: "application/pdf" }));
    const s = createSource({ title: "Registrul de botezuri", type: "document", repository: "Arhivele Naționale Prahova", date: "1843", citation: "Parohia Sf. Nicolae (1843). Registru.", blobKey: "blob_1_register.pdf", fileName: "register.pdf", mimeType: "application/pdf" });
    const project = createProject("P", { people: SAMPLE_PEOPLE, sources: [s] });
    const r = await linkProjectSourceToLibrary({ library, loadBlob, project, sourceId: s.id });

    expect(r.project.sources[0].librarySourceId).toBe(r.librarySourceId);
    const lib = await library.sources.get(r.librarySourceId);
    expect(lib).toMatchObject({ kind: "archival-document", title: "Registrul de botezuri", citation: "Parohia Sf. Nicolae (1843). Registru.", dateText: "1843", dateRange: { from: "1843", to: "1843" }, repositoryId: r.repositoryId });
    expect((await library.repositories.get(r.repositoryId)).name).toBe("Arhivele Naționale Prahova");
    const copy = await library.copies.get(r.copyId);
    expect(copy).toMatchObject({ sourceId: r.librarySourceId, fileName: "register.pdf", mimeType: "application/pdf", storage: { mode: "blob", blobKey: "blob_1_register.pdf" } });
    expect(copy.sha256).toHaveLength(64);
    expect(r.copyCreated).toBe(true);
  });

  it("leaves everything else in the project unchanged", async () => {
    const s = createSource({ title: "Note", type: "text", text: "just text" });
    const project = createProject("P", { people: SAMPLE_PEOPLE, sources: [s, createSource({ title: "Other" })] });
    const before = JSON.parse(JSON.stringify(project));
    const r = await linkProjectSourceToLibrary({ library, loadBlob, project, sourceId: s.id });
    expect(JSON.parse(JSON.stringify(project))).toEqual(before); // input not mutated
    const { sources: afterSources, ...restAfter } = r.project;
    const { sources: beforeSources, ...restBefore } = before;
    expect(restAfter).toEqual(restBefore);
    expect(afterSources[0]).toEqual({ ...before.sources[0], librarySourceId: r.librarySourceId });
    expect(afterSources[1]).toEqual(before.sources[1]);
    expect(r.warnings.join(" ")).toMatch(/text-only/);
    expect(r.copyId).toBeNull();
  });

  it("maps url sources to online repositories and web sources, keeping the URL and unparseable dates as written", async () => {
    const s = createSource({ title: "Universul 12 Mar 1920", type: "url", url: "https://adt.arcanum.com/x", repository: "Arcanum", date: "12 Martie 1920" });
    const r = await linkProjectSourceToLibrary({ library, loadBlob, project: createProject("P", { sources: [s] }), sourceId: s.id });
    const lib = await library.sources.get(r.librarySourceId);
    expect(lib).toMatchObject({ kind: "web", url: "https://adt.arcanum.com/x", dateText: "12 Martie 1920", dateRange: null });
    expect((await library.repositories.get(r.repositoryId))).toMatchObject({ name: "Arcanum", kind: "online" });
  });

  it("is idempotent: linking again changes nothing in the library", async () => {
    blobs.set("k", new Blob(["bytes"]));
    const s = createSource({ title: "S", type: "document", blobKey: "k", repository: "Biblioteca" });
    const first = await linkProjectSourceToLibrary({ library, loadBlob, project: createProject("P", { sources: [s] }), sourceId: s.id });
    const second = await linkProjectSourceToLibrary({ library, loadBlob, project: first.project, sourceId: s.id });
    expect(second.librarySourceId).toBe(first.librarySourceId);
    expect(second.copyId).toBe(first.copyId);
    expect(await storage.dbCount("evSources")).toBe(1);
    expect(await storage.dbCount("evCopies")).toBe(1);
    expect(await storage.dbCount("evRepositories")).toBe(1);
  });

  it("reuses a repository by name and does not duplicate a file attached to two project sources", async () => {
    blobs.set("k1", new Blob(["same bytes"])); blobs.set("k2", new Blob(["same bytes"]));
    const a = createSource({ title: "A", type: "document", blobKey: "k1", repository: "ANPh" });
    const b = createSource({ title: "B", type: "document", blobKey: "k2", repository: "anph" });
    let project = createProject("P", { sources: [a, b] });
    const ra = await linkProjectSourceToLibrary({ library, loadBlob, project, sourceId: a.id });
    const rb = await linkProjectSourceToLibrary({ library, loadBlob, project: ra.project, sourceId: b.id });
    expect(rb.repositoryId).toBe(ra.repositoryId);
    expect(await storage.dbCount("evRepositories")).toBe(1);
    expect(await storage.dbCount("evCopies")).toBe(1);
    expect(rb.copyCreated).toBe(false);
    expect(rb.copyId).toBe(ra.copyId);
    expect(rb.warnings.join(" ")).toMatch(/already registered under another library source/);
    expect(await storage.dbCount("evSources")).toBe(2);
  });

  it("copes with a missing file and with a missing project source", async () => {
    const s = createSource({ title: "Gone", type: "image", blobKey: "missing", fileMissing: false });
    const r = await linkProjectSourceToLibrary({ library, loadBlob, project: createProject("P", { sources: [s] }), sourceId: s.id });
    expect(r.copyId).toBeNull();
    expect(r.warnings.join(" ")).toMatch(/not found in storage/);
    const stripped = createSource({ title: "Stripped", type: "document", blobKey: "k", fileMissing: true });
    const r2 = await linkProjectSourceToLibrary({ library, loadBlob, project: createProject("P", { sources: [stripped] }), sourceId: stripped.id });
    expect(r2.copyId).toBeNull();
    await expect(linkProjectSourceToLibrary({ library, loadBlob, project: createProject("P"), sourceId: "nope" })).rejects.toThrow(/not found/);
  });
});
