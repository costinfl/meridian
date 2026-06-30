import { describe, it, expect } from "vitest";
import { createProject, createSource } from "../models/project.js";

describe("createProject", () => {
  it("applies all setting defaults", () => {
    const p = createProject("My Project");
    expect(p.name).toBe("My Project");
    expect(p.settings.view).toEqual({ left: 1842, ppy: 8 });
    expect(p.settings.ctxOn).toEqual({ local: true, national: true, global: true });
    expect(p.settings.relativeIds).toEqual([]);
    expect(p.settings.focusPersonId).toBeNull();
    expect(p.people).toEqual([]);
    expect(p.annotations).toEqual([]);
    expect(p.sources).toEqual([]);
    expect(p.description).toBe("");
  });

  it("sets focusPersonId to the first person's id", () => {
    const people = [{ id: "p1", name: "Alice" }, { id: "p2", name: "Bob" }];
    const p = createProject("Test", { people });
    expect(p.settings.focusPersonId).toBe("p1");
  });

  it("focuses nobody when people array is empty", () => {
    const p = createProject("Test", { people: [] });
    expect(p.settings.focusPersonId).toBeNull();
  });

  it("merges caller settings over defaults via spread", () => {
    const p = createProject("Test", { settings: { view: { left: 1900, ppy: 12 } } });
    expect(p.settings.view).toEqual({ left: 1900, ppy: 12 });
    expect(p.settings.ctxOn).toEqual({ local: true, national: true, global: true });
  });

  it("allows focusPersonId override even when people are provided", () => {
    const people = [{ id: "p1" }, { id: "p2" }];
    const p = createProject("Test", { people, settings: { focusPersonId: "p2" } });
    expect(p.settings.focusPersonId).toBe("p2");
  });

  it("generates unique ids across many calls", () => {
    const ids = new Set(Array.from({ length: 50 }, () => createProject("x").id));
    expect(ids.size).toBe(50);
  });

  it("stamps createdAt and updatedAt with equal ISO timestamps", () => {
    const before = new Date().toISOString();
    const p = createProject("T");
    const after = new Date().toISOString();
    expect(p.createdAt >= before).toBe(true);
    expect(p.createdAt <= after).toBe(true);
    expect(p.createdAt).toBe(p.updatedAt);
  });
});

describe("createSource", () => {
  it("applies all defaults", () => {
    const s = createSource({ title: "My photo" });
    expect(s.title).toBe("My photo");
    expect(s.type).toBe("text");
    expect(s.date).toBe("");
    expect(s.repository).toBe("");
    expect(s.description).toBe("");
    expect(s.citation).toBe("");
    expect(s.url).toBeNull();
    expect(s.text).toBeNull();
    expect(s.blobKey).toBeNull();
    expect(s.fileName).toBeNull();
    expect(s.mimeType).toBeNull();
    expect(s.linkedPersonIds).toEqual([]);
    expect(s.linkedYearRange).toBeNull();
    expect(s.tags).toEqual([]);
  });

  it("uses 'Untitled source' as the default title", () => {
    const s = createSource({});
    expect(s.title).toBe("Untitled source");
  });

  it("rest props spread over defaults", () => {
    const s = createSource({
      title: "Photo",
      type: "image",
      linkedPersonIds: ["p1", "p2"],
      linkedYearRange: [1900, 1950],
      blobKey: "blob_123",
    });
    expect(s.type).toBe("image");
    expect(s.linkedPersonIds).toEqual(["p1", "p2"]);
    expect(s.linkedYearRange).toEqual([1900, 1950]);
    expect(s.blobKey).toBe("blob_123");
  });

  it("generates unique ids across many calls", () => {
    const ids = new Set(Array.from({ length: 50 }, () => createSource({}).id));
    expect(ids.size).toBe(50);
  });
});