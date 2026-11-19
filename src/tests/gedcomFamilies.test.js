import { describe, it, expect } from "vitest";
import { parseGedcom, exportGedcom, mergeGedcomImport } from "../gedcom.js";
import { normalizeProject, createProject } from "../models/project.js";
import { kinshipLabel } from "../graph/kinship.js";

// Shaped like a GEDCOM 5.5.1 export from a desktop genealogy app: INDI records with FAMC / FAMS pointers and custom
// `_` tags, FAM records with HUSB / WIFE / CHIL and a MARR event. Three generations: grandparents I1 + I2; their
// children I3 (married to I4) and I5 (married to I6); grandchildren I7, I8 (of I3 + I4) and I9 (of I5 + I6).
const GED = `0 HEAD
1 SOUR MyFamilyTree
2 VERS 12.0
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Gheorghe /Popa/
1 SEX M
1 BIRT
2 DATE 12 MAR 1820
2 PLAC Craiova
1 FAMS @F1@
1 _UID 7F3A
0 @I2@ INDI
1 NAME Ana /Ionescu/
1 SEX F
1 FAMS @F1@
0 @I3@ INDI
1 NAME Ion /Popa/
1 SEX M
1 BIRT
2 DATE 1845
1 FAMC @F1@
1 FAMS @F2@
0 @I4@ INDI
1 NAME Elena /Marin/
1 SEX F
1 FAMS @F2@
0 @I5@ INDI
1 NAME Maria /Popa/
1 SEX F
1 BIRT
2 DATE 1848
1 FAMC @F1@
1 FAMS @F3@
0 @I6@ INDI
1 NAME Vasile /Dinu/
1 SEX M
1 FAMS @F3@
0 @I7@ INDI
1 NAME Petre /Popa/
1 SEX M
1 FAMC @F2@
0 @I8@ INDI
1 NAME Sofia /Popa/
1 SEX F
1 FAMC @F2@
0 @I9@ INDI
1 NAME Nicolae /Dinu/
1 SEX M
1 FAMC @F3@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
1 CHIL @I5@
1 MARR
2 DATE 4 JUN 1843
2 PLAC Craiova
1 _UID 99AA
0 @F2@ FAM
1 HUSB @I3@
1 WIFE @I4@
1 CHIL @I7@
1 CHIL @I8@
0 @F3@ FAM
1 HUSB @I6@
1 WIFE @I5@
1 CHIL @I9@
0 TRLR
`;

const id = (x) => "imp_" + x;

describe("GEDCOM import keeps families (Phase 8 review)", () => {
  it("reads FAM records: partners, children in order, marriage; parents and spouses on people", () => {
    const { people, families } = parseGedcom(GED);
    expect(people).toHaveLength(9);
    expect(families).toHaveLength(3);
    const f1 = families.find((f) => f.partner1Id === id("I1"));
    expect(f1).toMatchObject({ partner2Id: id("I2"), marriage: { date: "4 JUN 1843", placeText: "Craiova" }, status: "accepted", rationale: "Imported from GEDCOM" });
    expect(f1.children.map((c) => c.personId)).toEqual([id("I3"), id("I5")]);
    const by = Object.fromEntries(people.map((p) => [p.id, p]));
    expect(by[id("I3")]).toMatchObject({ fatherId: id("I1"), motherId: id("I2") });
    expect(by[id("I9")]).toMatchObject({ fatherId: id("I6"), motherId: id("I5") });
    expect(by[id("I1")].spouseIds).toEqual([id("I2")]);
    expect(by[id("I5")].spouseIds).toEqual([id("I6")]);
  });

  it("the relations survive normalizeProject and give precise kinship labels", () => {
    const base = normalizeProject(createProject("T"));
    const { project } = mergeGedcomImport(base, parseGedcom(GED));
    const p = normalizeProject(project);
    const by = Object.fromEntries(p.people.map((x) => [x.id, x]));
    const label = (focus, other) => kinshipLabel(by, by[id(focus)], by[id(other)]);
    expect(label("I7", "I3")).toBe("father");
    expect(label("I7", "I1")).toBe("grandparent");
    expect(label("I7", "I8")).toBe("sibling");
    expect(label("I7", "I9")).toBe("first cousin");
    expect(label("I7", "I5")).toBe("aunt");
    expect(label("I7", "I6")).toMatch(/^husband of the aunt$/);
    expect(label("I9", "I4")).not.toBe("relative");
  });

  it("re-importing into a project that already has the people adds the families, not the people", () => {
    const parsed = parseGedcom(GED);
    // the earlier import kept people only (no families)
    const before = normalizeProject({ ...createProject("T"), people: parsed.people.map((p) => ({ ...p, fatherId: null, motherId: null, spouseIds: [] })), families: [] });
    const r = mergeGedcomImport(before, parseGedcom(GED));
    expect(r.addedPeople).toBe(0);
    expect(r.addedFamilies).toBe(3);
    expect(r.project.people).toHaveLength(9);
    expect(r.project.people.find((p) => p.id === id("I7"))).toMatchObject({ fatherId: id("I3"), motherId: id("I4") });
    // and once more: nothing new
    const again = mergeGedcomImport(r.project, parseGedcom(GED));
    expect([again.addedPeople, again.addedFamilies, again.updatedFamilies]).toEqual([0, 0, 0]);
    expect(again.project.families).toHaveLength(3);
  });

  it("a child already placed with other parents keeps them; a couple's missing child is added", () => {
    const parsed = parseGedcom(GED);
    const before = normalizeProject({ ...createProject("T"), people: parsed.people.map((p) => ({ ...p })), families: [
      { id: "fx", partner1Id: id("I1"), partner2Id: id("I2"), children: [{ personId: id("I3"), order: 0 }], marriage: { date: null, placeText: "" }, status: "accepted", rationale: "" },
      { id: "fy", partner1Id: id("I6"), partner2Id: null, children: [{ personId: id("I9"), order: 0 }], marriage: { date: null, placeText: "" }, status: "accepted", rationale: "" },
    ] });
    const r = mergeGedcomImport(before, parsed);
    const fx = r.project.families.find((f) => f.id === "fx");
    expect(fx.children.map((c) => c.personId)).toEqual([id("I3"), id("I5")]);
    expect(r.updatedFamilies).toBe(1);
    expect(r.project.people.find((p) => p.id === id("I9"))).toMatchObject({ fatherId: id("I6"), motherId: null });  // kept
  });

  it("an export from Meridian reads back with the same families", () => {
    const { project } = mergeGedcomImport(normalizeProject(createProject("T")), parseGedcom(GED));
    const back = parseGedcom(exportGedcom(project.people));
    expect(back.families).toHaveLength(3);
    const kid = back.people.find((p) => p.name === "Petre Popa");
    const dad = back.people.find((p) => p.id === kid.fatherId);
    expect(dad.name).toBe("Ion Popa");
  });
});
