import { describe, it, expect } from "vitest";
import { createProject, normalizeProject } from "../models/project.js";
import { buildFamilies, derivePeopleFromFamilies, setParents, addPartners, removePartners } from "../models/families.js";
import { exportGedcom } from "../gedcom.js";
import { SAMPLE_PEOPLE } from "../sampleData.js";

const legacyFields = (people) => people.map((p) => ({ id: p.id, fatherId: p.fatherId ?? null, motherId: p.motherId ?? null, spouseIds: p.spouseIds ?? [] }));
const clone = (x) => JSON.parse(JSON.stringify(x));

describe("project model: conclusions (P4.T1)", () => {
  it("new projects carry empty conclusion lists and families built from their people", () => {
    const p = createProject("T");
    expect(p).toMatchObject({ families: [], personaLinks: [], relationships: [], conclusionEvidence: [], proofNotes: [] });
    expect(createProject("S", { people: SAMPLE_PEOPLE }).families.length).toBeGreaterThan(0);
  });

  it("an old project (no conclusion fields at all) upgrades transparently and keeps everything it had", () => {
    const old = { id: "x", name: "Old", people: clone(SAMPLE_PEOPLE), annotations: [], eras: [], sources: [], settings: { view: { left: 1900, ppy: 5 } } };
    const out = normalizeProject(old);
    expect(out).toMatchObject({ id: "x", name: "Old", personaLinks: [], relationships: [], conclusionEvidence: [], proofNotes: [], settings: { view: { left: 1900, ppy: 5 } } });
    expect(out.families.length).toBeGreaterThan(0);
    expect(out.people.map((p) => [p.id, p.name, p.birth?.year])).toEqual(old.people.map((p) => [p.id, p.name, p.birth?.year]));
    expect(normalizeProject(out)).toBe(out); // idempotent
  });

  it("every fact gains assertionIds and preferredAssertionId; existing values are kept", () => {
    const out = normalizeProject({ name: "t", people: [{ id: "a", birth: { year: 1850, place: "X", verified: true }, death: {}, events: [{ id: "e1", year: 1900, label: "x", assertionIds: ["k"], preferredAssertionId: "k" }, { year: 1910 }], periods: [{ start: 1, end: 2 }], groups: [{ start: 1, end: 2 }] }] });
    const p = out.people[0];
    for (const f of [p.birth, p.death, ...p.events, ...p.periods, ...p.groups]) {
      expect(Array.isArray(f.assertionIds)).toBe(true);
      expect("preferredAssertionId" in f).toBe(true);
    }
    expect(p.events[0]).toMatchObject({ id: "e1", assertionIds: ["k"], preferredAssertionId: "k" });
    expect(p.events[1].assertionIds).toEqual([]);
    expect(p.birth).toMatchObject({ year: 1850, place: "X", verified: true, preferredAssertionId: null });
  });

  it("a person without birth/death objects is left alone", () => {
    const out = normalizeProject({ name: "t", people: [{ id: "a", name: "A" }] });
    expect(out.people[0].birth).toBeUndefined();
    expect(out.people[0].death).toBeUndefined();
  });
});

describe("families as source of truth (P4.T2, I8)", () => {
  it("sample data: families derived from the legacy fields give back exactly the same fields", () => {
    const fams = buildFamilies(SAMPLE_PEOPLE);
    const derived = derivePeopleFromFamilies(SAMPLE_PEOPLE, fams);
    expect(derived).toBe(SAMPLE_PEOPLE); // nothing to change: returned as is
    expect(legacyFields(derived)).toEqual(legacyFields(SAMPLE_PEOPLE));
  });

  it("normalizing a project built from the sample does not change a single person field except the evidence fields", () => {
    const project = createProject("Hariton", { people: clone(SAMPLE_PEOPLE) });
    const out = normalizeProject(project);
    expect(legacyFields(out.people)).toEqual(legacyFields(SAMPLE_PEOPLE));
    const strip = (f) => { const { assertionIds, preferredAssertionId, id, ...rest } = f; return rest; }; // normalize adds evidence fields and ids
    const stripAll = (person) => ({ ...person, birth: person.birth && strip(person.birth), death: person.death && strip(person.death), events: person.events.map(strip), periods: person.periods.map(strip), groups: person.groups.map(strip), media: person.media ?? [] });
    expect(out.people.map(stripAll)).toEqual(SAMPLE_PEOPLE.map(stripAll));
  });

  it("GEDCOM export of the sample project is byte-identical before and after (I8)", () => {
    const before = exportGedcom(clone(SAMPLE_PEOPLE), { sources: [] });
    const after = exportGedcom(normalizeProject(createProject("H", { people: clone(SAMPLE_PEOPLE) })).people, { sources: [] });
    expect(after).toBe(before);
    // and when the project was saved by an older build (legacy fields only) and is upgraded on load
    const upgraded = normalizeProject({ name: "old", people: clone(SAMPLE_PEOPLE) });
    expect(exportGedcom(upgraded.people, { sources: [] })).toBe(before);
    expect(before).toMatch(/1 FAMC/); // the sample really has families
  });

  it("builds one family per couple, parents first, childless couples after, children in input order", () => {
    const people = [
      { id: "a", sex: "M", spouseIds: ["b"] }, { id: "b", sex: "F", spouseIds: ["a"] },
      { id: "c", sex: "M", fatherId: "a", motherId: "b", spouseIds: [] }, { id: "d", sex: "F", fatherId: "a", motherId: "b", spouseIds: [] },
      { id: "e", sex: "F", fatherId: "a", motherId: null, spouseIds: [] }, { id: "x", sex: "M", spouseIds: ["y"] }, { id: "y", sex: "F", spouseIds: ["x"] },
    ];
    const fams = buildFamilies(people);
    expect(fams.map((f) => [f.partner1Id, f.partner2Id, f.children.map((c) => c.personId)])).toEqual([
      ["a", "b", ["c", "d"]], ["a", null, ["e"]], ["x", "y", []],
    ]);
    expect(fams[0].children.map((c) => c.order)).toEqual([0, 1]);
    expect(derivePeopleFromFamilies(people, fams)).toBe(people);
  });

  it("couples of unknown sex that list each other become one family, not two", () => {
    const people = [{ id: "a", sex: "U", spouseIds: ["b"] }, { id: "b", sex: "U", spouseIds: ["a"] }];
    expect(buildFamilies(people)).toHaveLength(1);
  });

  it("keeps the order of a person's spouse list when the set is unchanged (people married before the person they appear after)", () => {
    const people = [
      { id: "b", sex: "F", spouseIds: ["p"] },
      { id: "p", sex: "M", spouseIds: ["a", "b"] },       // order a, b even though b was listed first
      { id: "a", sex: "F", spouseIds: ["p"] },
    ];
    const out = normalizeProject({ name: "t", people });
    expect(out.people.find((p) => p.id === "p").spouseIds).toEqual(["a", "b"]);
    expect(out.people.find((p) => p.id === "p")).toBe(out.people.find((p) => p.id === "p"));
    expect(legacyFields(out.people)).toEqual(legacyFields(people));
  });

  it("once families exist they win: stale legacy fields are re-derived from them", () => {
    const base = createProject("T", { people: [{ id: "f", sex: "M" }, { id: "m", sex: "F" }, { id: "c", sex: "M", fatherId: "f", motherId: "m" }] });
    const stale = { ...base, people: base.people.map((p) => (p.id === "c" ? { ...p, fatherId: "wrong", motherId: null } : p)) };
    const out = normalizeProject(stale);
    expect(out.people.find((p) => p.id === "c")).toMatchObject({ fatherId: "f", motherId: "m" });
    expect(out.people.find((p) => p.id === "f").spouseIds).toEqual(["m"]);
  });

  it("preserves null versus undefined on untouched people", () => {
    const people = [{ id: "a", sex: "M" }, { id: "b", sex: "F", fatherId: null, motherId: null, spouseIds: [] }];
    const out = normalizeProject({ name: "t", people });
    expect("fatherId" in out.people[0]).toBe(false);
    expect(out.people[1].fatherId).toBeNull();
  });
});

describe("family functions: how parents and spouses are edited", () => {
  const base = () => createProject("T", { people: [
    { id: "f", sex: "M", spouseIds: [] }, { id: "m", sex: "F", spouseIds: [] }, { id: "c", sex: "M", spouseIds: [] }, { id: "d", sex: "F", spouseIds: [] },
  ] });

  it("setParents creates a family, derives the legacy fields, and moves a child between families", () => {
    let p = setParents(base(), "c", { fatherId: "f", motherId: "m" });
    expect(p.families).toHaveLength(1);
    expect(p.people.find((x) => x.id === "c")).toMatchObject({ fatherId: "f", motherId: "m" });
    expect(p.people.find((x) => x.id === "f").spouseIds).toEqual(["m"]);
    p = setParents(p, "d", { fatherId: "f", motherId: "m" });
    expect(p.families).toHaveLength(1);
    expect(p.families[0].children.map((c) => [c.personId, c.order])).toEqual([["c", 0], ["d", 1]]);
    p = setParents(p, "c", { fatherId: "f" });                   // only the father now
    expect(p.people.find((x) => x.id === "c")).toMatchObject({ fatherId: "f", motherId: null });
    expect(p.families).toHaveLength(2);
    p = setParents(p, "c", {});                                   // no parents
    expect(p.people.find((x) => x.id === "c")).toMatchObject({ fatherId: null, motherId: null });
    expect(p.families).toHaveLength(1);                           // the single-parent shell is gone
    expect(legacyFields(normalizeProject(p).people)).toEqual(legacyFields(p.people)); // consistent with a reload
  });

  it("addPartners / removePartners keep spouses symmetric and children attached", () => {
    let p = addPartners(base(), "f", "m");
    expect(p.people.find((x) => x.id === "f").spouseIds).toEqual(["m"]);
    expect(p.people.find((x) => x.id === "m").spouseIds).toEqual(["f"]);
    expect(addPartners(p, "m", "f")).toBe(p);                      // already partners
    p = setParents(p, "c", { fatherId: "f", motherId: "m" });
    expect(p.families).toHaveLength(1);
    p = removePartners(p, "f", "m");
    expect(p.people.find((x) => x.id === "f").spouseIds).toEqual([]);
    expect(p.people.find((x) => x.id === "c")).toMatchObject({ fatherId: "f", motherId: null }); // child keeps the surviving parent
    const q = removePartners(addPartners(base(), "f", "m"), "f", "m");
    expect(q.families).toEqual([]);                                // childless partnership disappears
  });

  it("the sample project edited through family functions still exports valid GEDCOM with the new relation", () => {
    const sample = normalizeProject(createProject("H", { people: clone(SAMPLE_PEOPLE) }));
    const edited = setParents(sample, "i6", { fatherId: "i1", motherId: "i4" });
    const ged = exportGedcom(edited.people, { sources: [] });
    expect(ged).toContain("1 FAMC");
    expect(edited.people.find((x) => x.id === "i6")).toMatchObject({ fatherId: "i1", motherId: "i4" });
  });
});
