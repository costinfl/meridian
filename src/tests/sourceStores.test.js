import { describe, it, expect, beforeEach } from "vitest";
import { freshStorage } from "./evidenceHelpers.js";
import { createRepositoryStore } from "../evidence/repositories/repositoryStore.js";
import { createSourceStore } from "../evidence/repositories/sourceStore.js";
import { nowIso } from "../evidence/ids.js";

let storage, repos, sources;
beforeEach(() => { storage = freshStorage(); repos = createRepositoryStore(storage); sources = createSourceStore(storage); });

describe("ids", () => {
  it("nowIso is strictly increasing", () => {
    const a = Array.from({ length: 50 }, () => nowIso());
    expect([...a].sort()).toEqual(a);
    expect(new Set(a).size).toBe(50);
  });
});

describe("Repository store", () => {
  it("creates, reads, lists and finds by name (case-insensitive)", async () => {
    const r = await repos.create({ name: "Arhivele Naționale Prahova", kind: "archive", location: "Ploiești" });
    expect(r.id).toBeTruthy();
    expect(await repos.get(r.id)).toEqual(r);
    expect(await repos.get("nope")).toBeNull();
    await repos.create({ name: "Arcanum", kind: "online", url: "https://adt.arcanum.com" });
    expect((await repos.list()).map((x) => x.name)).toEqual(["Arcanum", "Arhivele Naționale Prahova"]);
    expect((await repos.findByName("arcanum")).kind).toBe("online");
  });
  it("validates input and updates descriptive metadata only", async () => {
    await expect(repos.create({ name: "  " })).rejects.toMatchObject({ code: "invalid" });
    await expect(repos.create({ name: "X", kind: "cloud" })).rejects.toMatchObject({ code: "invalid" });
    const r = await repos.create({ name: "Biblioteca" , kind: "library" });
    const u = await repos.update(r.id, { location: "Cluj", id: "hijack", createdAt: "1999-01-01" });
    expect(u.location).toBe("Cluj");
    expect(u.id).toBe(r.id);
    expect(u.createdAt).toBe(r.createdAt);
    await expect(repos.update("missing", { name: "x" })).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("LibrarySource store", () => {
  it("creates a source with defaults and call-number fields", async () => {
    const repo = await repos.create({ name: "ANPh" });
    const s = await sources.create({
      kind: "parish-register", title: "Registrul de botezuri 1840-1850", issuingAuthority: "Biserica Sf. Nicolae",
      languages: ["ro"], script: "cyrillic-transitional", repositoryId: repo.id,
      callNumber: { fond: "Parohia Sf. Nicolae", inventory: "12", file: "34/1843" },
      dateRange: { from: "1840-01-01", to: "1850-12-31" },
    });
    expect(await sources.get(s.id)).toEqual(s);
    expect(s.callNumber).toEqual({ fond: "Parohia Sf. Nicolae", inventory: "12", file: "34/1843" });
    expect(s.parentSourceId).toBeNull();
  });

  it("validates kind, title, date range, repository and parent", async () => {
    await expect(sources.create({ kind: "diary", title: "x" })).rejects.toMatchObject({ code: "invalid" });
    await expect(sources.create({ kind: "book", title: "" })).rejects.toMatchObject({ code: "invalid" });
    await expect(sources.create({ title: "x", dateRange: { from: "1900-01-01", to: "1800-01-01" } })).rejects.toMatchObject({ code: "invalid" });
    await expect(sources.create({ title: "x", repositoryId: "nope" })).rejects.toMatchObject({ code: "not-found" });
    await expect(sources.create({ title: "x", parentSourceId: "nope" })).rejects.toMatchObject({ code: "not-found" });
    expect(await storage.dbCount("evSources")).toBe(0); // failed creates leave nothing behind
  });

  it("builds a hierarchy: newspaper title -> issue; lists children and ancestors", async () => {
    const title = await sources.create({ kind: "newspaper-title", title: "Universul" });
    const year = await sources.create({ kind: "newspaper-title", title: "Universul 1920", parentSourceId: title.id });
    const issue = await sources.create({ kind: "newspaper-issue", title: "Universul 12 Mar 1920", parentSourceId: year.id });
    expect((await sources.children(title.id)).map((s) => s.id)).toEqual([year.id]);
    expect((await sources.children(year.id)).map((s) => s.id)).toEqual([issue.id]);
    expect((await sources.ancestors(issue.id)).map((s) => s.id)).toEqual([year.id, title.id]);
    expect(await sources.ancestors(title.id)).toEqual([]);
  });

  it("rejects a hierarchy cycle and self-parenting on update", async () => {
    const a = await sources.create({ title: "A" });
    const b = await sources.create({ title: "B", parentSourceId: a.id });
    const c = await sources.create({ title: "C", parentSourceId: b.id });
    await expect(sources.update(a.id, { parentSourceId: c.id })).rejects.toMatchObject({ code: "invariant" });
    await expect(sources.update(a.id, { parentSourceId: a.id })).rejects.toMatchObject({ code: "invariant" });
    expect((await sources.get(a.id)).parentSourceId).toBeNull();
  });

  it("updates metadata (whitelisted fields only) and bumps updatedAt", async () => {
    const s = await sources.create({ title: "Old title", kind: "book" });
    const u = await sources.update(s.id, { title: "New title", citation: "APA...", callNumber: { file: "7" }, id: "x", createdAt: "2000" });
    expect(u).toMatchObject({ id: s.id, title: "New title", citation: "APA...", createdAt: s.createdAt });
    expect(u.callNumber).toEqual({ fond: "", inventory: "", file: "7" });
    expect(u.updatedAt > s.updatedAt).toBe(true);
    await expect(sources.update("missing", { title: "x" })).rejects.toMatchObject({ code: "not-found" });
  });
});
