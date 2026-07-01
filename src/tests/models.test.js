import { describe, it, expect } from "vitest";
import {
  createProject, createSource, createEvent, createPeriod, createGroup,
  createAnnotation, createEra, createMediaPin, normalizeProject,
} from "../models/project.js";

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
    expect(p.eras).toEqual([]);
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
    expect(s.verified).toBe(false);
    expect(s.fileMissing).toBe(false);
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

describe("timeline item factories", () => {
  it("createEvent applies defaults and keeps the year", () => {
    const e = createEvent({ year: 1893, label: "Elected mayor" });
    expect(e.year).toBe(1893);
    expect(e.label).toBe("Elected mayor");
    expect(e.type).toBe("note");
    expect(e.note).toBe("");
    expect(e.color).toBeNull();
    expect(e.sourceId).toBeNull();
    expect(typeof e.id).toBe("string");
  });

  it("createPeriod / createGroup normalize span + optional fields", () => {
    const p = createPeriod({ start: 1893, end: 1897, label: "Mayor", color: "#445A75" });
    expect(p.start).toBe(1893);
    expect(p.end).toBe(1897);
    expect(p.color).toBe("#445A75");
    const g = createGroup({ start: 1880, end: 1921, label: "Estate", sourceId: "s1" });
    expect(g.sourceId).toBe("s1");
    expect(g.id).not.toBe(p.id);
  });

  it("createAnnotation carries laneKey + title", () => {
    const a = createAnnotation({ laneKey: "p:i1", start: 1914, end: 1919, title: "Gap" });
    expect(a.laneKey).toBe("p:i1");
    expect(a.title).toBe("Gap");
  });

  it("createEra and createMediaPin", () => {
    const era = createEra({ start: 1947, end: 1989, label: "Communist regime" });
    expect(era.label).toBe("Communist regime");
    const m = createMediaPin({ year: 1920, sourceId: "s2" });
    expect(m.year).toBe(1920);
    expect(m.sourceId).toBe("s2");
  });

  it("event/period/group default to unverified", () => {
    expect(createEvent({ year: 1 }).verified).toBe(false);
    expect(createPeriod({ start: 1, end: 2 }).verified).toBe(false);
    expect(createGroup({ start: 1, end: 2 }).verified).toBe(false);
  });

  it("verified can be set explicitly on a factory", () => {
    expect(createEvent({ year: 1, verified: true }).verified).toBe(true);
    expect(createPeriod({ start: 1, end: 2, verified: true }).verified).toBe(true);
  });

  it("all factories mint unique ids", () => {
    const ids = new Set([
      createEvent({ year: 1 }).id, createPeriod({ start: 1, end: 2 }).id,
      createGroup({ start: 1, end: 2 }).id, createAnnotation({ laneKey: "x", start: 1, end: 2 }).id,
      createEra({ start: 1, end: 2 }).id, createMediaPin({ year: 1 }).id,
    ]);
    expect(ids.size).toBe(6);
  });
});

describe("normalizeProject", () => {
  it("returns the same object when nothing needs upgrading", () => {
    const p = createProject("T");
    expect(normalizeProject(p)).toBe(p);
  });

  it("adds an eras array to legacy projects", () => {
    const legacy = { name: "old", people: [], annotations: [] };
    const out = normalizeProject(legacy);
    expect(out.eras).toEqual([]);
    expect(out).not.toBe(legacy);
  });

  it("fills missing ids on person sub-items and ensures arrays", () => {
    const legacy = {
      name: "old",
      people: [{ id: "i1", events: [{ year: 1900, label: "x" }], periods: [{ start: 1, end: 2 }] }],
      annotations: [{ start: 1, end: 2, note: "n" }],
    };
    const out = normalizeProject(legacy);
    const person = out.people[0];
    expect(person.events[0].id).toBeTruthy();
    expect(person.periods[0].id).toBeTruthy();
    expect(person.groups).toEqual([]);
    expect(person.media).toEqual([]);
    expect(out.annotations[0].id).toBeTruthy();
  });

  it("preserves existing ids", () => {
    const legacy = {
      name: "keep", eras: [],
      people: [{ id: "i1", events: [{ id: "keep-me", year: 1900 }], periods: [], groups: [], media: [] }],
      annotations: [],
    };
    const out = normalizeProject(legacy);
    expect(out.people[0].events[0].id).toBe("keep-me");
    expect(out.people[0]).toBe(legacy.people[0]);
  });

  it("handles null input", () => {
    expect(normalizeProject(null)).toBeNull();
  });
});