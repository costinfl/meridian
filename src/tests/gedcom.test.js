import { describe, it, expect } from "vitest";
import { exportGedcom, parseGedcom } from "../gedcom.js";
import { createEvent, createPeriod, createGroup, createSource } from "../models/project.js";

/* A person with one of every fact kind, all UNVERIFIED unless the test flips them. */
function samplePeople() {
  return [{
    id: "i1",
    name: "Ion Popescu",
    sex: "M",
    birth: { year: 1850, place: "Ploiești" },
    death: { year: 1921, place: "București" },
    events: [createEvent({ year: 1888, label: "Founded school", type: "achievement" })],
    periods: [createPeriod({ start: 1893, end: 1897, label: "Mayor" })],
    groups: [createGroup({ start: 1880, end: 1921, label: "Estate era", note: "Family lands" })],
    spouseIds: [],
  }];
}

describe("exportGedcom — verified gating", () => {
  it("always emits the INDI/FAM skeleton but no unverified facts", () => {
    const ged = exportGedcom(samplePeople(), { sources: [] });
    expect(ged).toContain("0 @I1@ INDI");
    expect(ged).toContain("1 NAME Ion /Popescu/");
    expect(ged).toContain("1 SEX M");
    expect(ged).toMatch(/^0 HEAD/);
    expect(ged.trimEnd()).toMatch(/0 TRLR$/);
    // nothing is verified → no facts
    expect(ged).not.toContain("1 BIRT");
    expect(ged).not.toContain("1 DEAT");
    expect(ged).not.toContain("1 EVEN");
    expect(ged).not.toContain("1 OCCU");
  });

  it("emits standard tags once the facts are marked verified", () => {
    const people = samplePeople();
    const p = people[0];
    p.birth.verified = true;
    p.death.verified = true;
    p.events[0].verified = true;
    p.periods[0].verified = true;
    p.groups[0].verified = true;

    const ged = exportGedcom(people, { sources: [] });
    expect(ged).toContain("1 BIRT");
    expect(ged).toContain("2 DATE 1850");
    expect(ged).toContain("2 PLAC Ploiești");
    expect(ged).toContain("1 DEAT");
    expect(ged).toContain("1 EVEN Founded school");
    expect(ged).toContain("2 TYPE achievement");
    expect(ged).toContain("1 OCCU Mayor");
    expect(ged).toContain("2 DATE FROM 1893 TO 1897");
    // group band has no standard tag → NOTE with the span
    expect(ged).toContain("1 NOTE Estate era (1880–1921)");
  });

  it("only marking one fact verified exports just that fact", () => {
    const people = samplePeople();
    people[0].birth.verified = true; // death stays unverified
    const ged = exportGedcom(people, { sources: [] });
    expect(ged).toContain("1 BIRT");
    expect(ged).not.toContain("1 DEAT");
  });
});

describe("exportGedcom — source citations", () => {
  it("emits a SOUR record only for a verified source cited by a verified item", () => {
    const src = createSource({ title: "Town records", verified: true, citation: "Popescu, I. (1890). Town records. Archive." });
    const people = samplePeople();
    people[0].events[0].verified = true;
    people[0].events[0].sourceId = src.id;

    const ged = exportGedcom(people, { sources: [src] });
    expect(ged).toContain("0 @S1@ SOUR");
    expect(ged).toContain("1 TITL Town records");
    expect(ged).toContain("2 SOUR @S1@"); // citation under the event
    expect(ged).toContain("Popescu, I. (1890)");
  });

  it("does not cite an unverified source even when linked to a verified item", () => {
    const src = createSource({ title: "Rumor", verified: false });
    const people = samplePeople();
    people[0].events[0].verified = true;
    people[0].events[0].sourceId = src.id;

    const ged = exportGedcom(people, { sources: [src] });
    expect(ged).not.toContain("SOUR @S1@");
    expect(ged).not.toContain("0 @S1@ SOUR");
  });
});

describe("exportGedcom — family links", () => {
  it("builds a FAM record linking parents and child", () => {
    const people = [
      { id: "dad", name: "Gheorghe Popescu", sex: "M", birth: {}, death: {}, events: [], periods: [], groups: [], spouseIds: [] },
      { id: "mom", name: "Maria Popescu", sex: "F", birth: {}, death: {}, events: [], periods: [], groups: [], spouseIds: [] },
      { id: "kid", name: "Ion Popescu", sex: "M", fatherId: "dad", motherId: "mom", birth: {}, death: {}, events: [], periods: [], groups: [], spouseIds: [] },
    ];
    const ged = exportGedcom(people, { sources: [] });
    expect(ged).toContain("1 HUSB @DAD@");
    expect(ged).toContain("1 WIFE @MOM@");
    expect(ged).toContain("1 CHIL @KID@");
    expect(ged).toContain("1 FAMC @F1@"); // child references its family
  });
});

describe("parseGedcom", () => {
  const fixture = [
    "0 HEAD",
    "0 @I1@ INDI",
    "1 NAME Ion /Popescu/",
    "1 SEX M",
    "1 BIRT",
    "2 DATE 1850",
    "2 PLAC Ploiești",
    "1 OCCU Mayor",
    "2 DATE FROM 1893 TO 1897",
    "2 SOUR @S1@",
    "1 EVEN Founded school",
    "2 TYPE achievement",
    "2 DATE 1888",
    "1 NOTE Estate era (1880–1921). Family lands.",
    "0 @S1@ SOUR",
    "1 TITL Town records",
    "1 TEXT Popescu, I. (1890). Town records.",
    "0 TRLR",
  ].join("\n");

  it("reads INDI facts, OCCU, EVEN and NOTE back into the model", () => {
    const { people } = parseGedcom(fixture);
    expect(people).toHaveLength(1);
    const p = people[0];
    expect(p.name).toBe("Ion Popescu");
    expect(p.sex).toBe("M");
    expect(p.birth.year).toBe(1850);
    expect(p.birth.place).toBe("Ploiești");

    expect(p.periods[0]).toMatchObject({ start: 1893, end: 1897, label: "Mayor" });
    expect(p.events[0]).toMatchObject({ year: 1888, label: "Founded school", type: "achievement" });
    expect(p.groups[0]).toMatchObject({ start: 1880, end: 1921, label: "Estate era" });
  });

  it("imports every item as unverified", () => {
    const { people } = parseGedcom(fixture);
    const p = people[0];
    expect(p.periods[0].verified).toBe(false);
    expect(p.events[0].verified).toBe(false);
    expect(p.groups[0].verified).toBe(false);
  });

  it("reconstructs SOUR records and links them by sourceId", () => {
    const { people, sources } = parseGedcom(fixture);
    expect(sources).toHaveLength(1);
    expect(sources[0].title).toBe("Town records");
    expect(sources[0].citation).toContain("Popescu, I. (1890)");
    // the OCCU cited @S1@ → its sourceId points at the parsed source
    expect(people[0].periods[0].sourceId).toBe(sources[0].id);
  });

  it("drops empty/anonymous individuals with no facts", () => {
    const { people } = parseGedcom(["0 HEAD", "0 @I9@ INDI", "0 TRLR"].join("\n"));
    expect(people).toHaveLength(0);
  });
});

describe("GEDCOM round-trip", () => {
  it("verified facts survive export → parse", () => {
    const people = samplePeople();
    const p = people[0];
    p.birth.verified = true;
    p.death.verified = true;
    p.events[0].verified = true;
    p.periods[0].verified = true;

    const { people: back } = parseGedcom(exportGedcom(people, { sources: [] }));
    const q = back[0];
    expect(q.name).toBe("Ion Popescu");
    expect(q.birth.year).toBe(1850);
    expect(q.death.year).toBe(1921);
    expect(q.periods[0]).toMatchObject({ start: 1893, end: 1897, label: "Mayor" });
    expect(q.events[0]).toMatchObject({ year: 1888, label: "Founded school", type: "achievement" });
    // imported facts always come back unverified
    expect(q.events[0].verified).toBe(false);
  });
});
