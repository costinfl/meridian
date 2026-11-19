import { describe, it, expect } from "vitest";
import { compareOccupation } from "../resolve/compare.js";
import { scorePair } from "../resolve/score.js";
import { jaroWinkler, nameSimilarity, compareGiven, compareSurname, compareDates, compareSex, comparePlaces, compareRelatives, compareFan, comparePair } from "../resolve/compare.js";
import { variantKeys } from "../resolve/blocking.js";
import { personaProfiles, personProfiles } from "../resolve/profiles.js";
import { toJdn } from "../evidence/domain/fuzzyDate.js";
import { resolveFixture } from "./resolveHelpers.js";

const yr = (a, b = a) => [toJdn(a, 1, 1), toJdn(b, 12, 31)];

describe("Comparators (P9.T2)", () => {
  it("Jaro–Winkler: known values, symmetric, 0..1", () => {
    expect(jaroWinkler("martha", "marhta")).toBeCloseTo(0.961, 3);
    expect(jaroWinkler("dwayne", "duane")).toBeCloseTo(0.84, 2);
    expect(jaroWinkler("hariton", "haritonu")).toBeGreaterThan(0.95);
    expect(jaroWinkler("abc", "xyz")).toBe(0);
    expect(jaroWinkler("", "")).toBe(0);
    expect(jaroWinkler("ion", "ioan")).toBe(jaroWinkler("ioan", "ion"));
  });

  it("names: equal, paired variants, sound-alike floor, best over tokens, unknown when missing", () => {
    const v = variantKeys([{ canonical: "Ioan", variant: "Iohannes" }]);
    expect(nameSimilarity(["iohannes"], ["ioan"], v)).toBe(1);
    expect(nameSimilarity(["iohannes"], ["ioan"])).toBeLessThan(1);
    expect(nameSimilarity(["sfatu"], ["szvet"])).toBeGreaterThanOrEqual(0.85);      // DM: sounds alike
    expect(nameSimilarity(["ana", "maria"], ["maria"])).toBe(1);
    expect(nameSimilarity([], ["ion"])).toBeNull();
    expect(compareGiven({ given: ["ion"] }, { given: [] })).toBeNull();
  });

  it("surnames: a borrowed or a woman's surname that differs is unknown, not a mismatch", () => {
    expect(compareSurname({ surnames: ["haritonu"] }, { surnames: ["hariton"] })).toBeGreaterThan(0.9);
    expect(compareSurname({ surnames: ["popescu"], sex: "M" }, { surnames: ["hariton"], sex: "M" })).toBeLessThan(0.6);
    expect(compareSurname({ surnames: ["popescu"], sex: "F" }, { surnames: ["hariton"] })).toBeNull();
    expect(compareSurname({ surnames: ["popescu"], surnameFrom: "father" }, { surnames: ["hariton"] })).toBeNull();
  });

  it("dates: vetoes, narrow overlap counts more than a wide window, gaps lose value, unknown when missing", () => {
    expect(compareDates({ alive: yr(1880) }, { death: yr(1870) })).toEqual({ value: 0, veto: "named alive after the death" });
    expect(compareDates({ alive: yr(1840) }, { birth: yr(1850) })).toEqual({ value: 0, veto: "named before the birth" });
    expect(compareDates({ alive: yr(1840) }, { birth: yr(1790, 1850) }).veto).toBeNull();    // a wide birth window: no veto
    const narrow = compareDates({ birth: yr(1849, 1851) }, { birth: yr(1850) }).value;
    const wide = compareDates({ birth: yr(1790, 1850) }, { birth: yr(1850) }).value;
    expect(narrow).toBeGreaterThan(0.95);
    expect(wide).toBeLessThan(narrow);
    expect(compareDates({ birth: yr(1860) }, { birth: yr(1850) }).value).toBeLessThan(0.1);
    expect(compareDates({}, { birth: yr(1850) })).toEqual({ value: null, veto: null });
    expect(compareDates({ death: yr(1890) }, { death: yr(1890) }).value).toBe(1);
  });

  it("sex: veto on a clear mismatch, unknown when missing", () => {
    expect(compareSex({ sex: "M" }, { sex: "F" })).toEqual({ value: 0, veto: "different sex" });
    expect(compareSex({ sex: "F" }, { sex: "F" }).value).toBe(1);
    expect(compareSex({ sex: null }, { sex: "F" }).value).toBeNull();
  });

  it("places: same, inside, shared word, different, unknown", () => {
    expect(comparePlaces({ placeId: "a" }, { placeId: "a" })).toBe(1);
    expect(comparePlaces({ placeId: "a" }, { placeId: "b" }, new Map([["a", new Set(["b"])]]))).toBe(1);
    expect(comparePlaces({ places: ["Craiova"] }, { places: ["oraș Craiova"] })).toBe(1);
    expect(comparePlaces({ places: ["Craiova"] }, { places: ["Ploiești"] })).toBe(0.3);
    expect(comparePlaces({ places: [] }, { places: ["Ploiești"] })).toBeNull();
  });

  it("relatives and FAN on the fixture: a baptised child's father matches the tree father; shared associates", async () => {
    const fx = await resolveFixture();
    const pp = personaProfiles(await fx.library.searchIndex.snapshot());
    const persons = personProfiles({ people: fx.people, families: fx.families, links: [], personaProfiles: pp });
    const ctx = { persons, personas: pp, acceptedPersonOf: new Map() };
    const child = pp.get(fx.personas["b1850.child"].id);
    const r = compareRelatives(child, persons.get("t3"), ctx);
    expect(r.value).toBeGreaterThan(0.9);
    expect(r.matches.map((m) => [m.relation, m.a, m.b])).toEqual([["father", "dumitru hariton", "dumitru hariton"], ["mother", "maria hariton", "maria hariton valeanu"]]);
    expect(compareRelatives(child, persons.get("t6"), ctx).value).toBeNull();             // t6 has no parents in the tree
    // the father of the 1850 baptism accepted as t1: then the child shares an associate with t3 (t1 is t3's father)
    ctx.acceptedPersonOf = new Map([[fx.personas["b1850.father"].id, "t1"]]);
    expect(compareFan(child, persons.get("t3"), ctx)).toEqual({ value: 1, shared: ["t1"] });
    expect(compareRelatives(child, persons.get("t3"), ctx).matches[0].value).toBe(1);    // same linked person
    expect(compareFan(child, persons.get("t6"), ctx).value).toBeNull();
  });

  it("all signals for a pair, with the veto", async () => {
    const fx = await resolveFixture();
    const pp = personaProfiles(await fx.library.searchIndex.snapshot());
    const persons = personProfiles({ people: fx.people, families: fx.families, links: [], personaProfiles: pp });
    const ctx = { persons, personas: pp, acceptedPersonOf: new Map(), variants: variantKeys([{ canonical: "Ion", variant: "Iohannes" }]) };
    const good = comparePair(pp.get(fx.personas["b1877.father"].id), persons.get("t3"), ctx);
    expect(good.veto).toBeNull();
    expect(good.signals).toMatchObject({ given: 1, surname: 1, sex: 1 });
    expect(good.signals.relatives).toBeGreaterThan(0.8);           // mother Elena ~ spouse Elena Hariton; child Gheorghe ~ child Gheorghe
    const bad = comparePair(pp.get(fx.personas["b1850.mother"].id), persons.get("t1"), ctx);
    expect(bad.veto).toBe("different sex");
    const dead = comparePair(pp.get(fx.personas["d1890.informant"].id), { ...persons.get("t3"), death: [toJdn(1880, 1, 1), toJdn(1880, 12, 31)] }, ctx);
    expect(dead.veto).toBe("named alive after the death");
  });
});

describe("Godparents and witnesses: one agreeing detail (Phase 9 review)", () => {
  it("occupation: shared word, close spelling, unknown when missing", () => {
    expect(compareOccupation({ occupations: ["plugar"] }, { occupations: ["Plugar în Săhăteni"] })).toBe(1);
    expect(compareOccupation({ occupations: ["învățător"] }, { occupations: ["Invatator"] })).toBe(1);
    expect(compareOccupation({ occupations: ["preot"] }, { occupations: ["Primar"] })).toBeLessThan(0.85);
    expect(compareOccupation({ occupations: [] }, { occupations: ["Primar"] })).toBeNull();
  });

  const pair = (persona, person) => scorePair(comparePair(persona, person, { persons: new Map(), personas: new Map(), acceptedPersonOf: new Map() }));
  const godmother = (extra = {}) => ({ id: "g", recordId: "r", role: "godparent", given: ["ana"], surnames: ["popescu"], tokens: ["ana", "popescu"], sex: null,
    birth: [toJdn(1760, 1, 1), toJdn(1836, 12, 31)], death: null, alive: yr(1850), places: [], occupations: [], relatives: [], others: [], ...extra });
  const ana = (extra = {}) => ({ id: "t", given: ["ana"], surnames: ["popescu"], tokens: ["ana", "popescu"], sex: "F", birth: yr(1820), death: null,
    places: ["Craiova"], occupations: [], parents: [], spouses: [], children: [], linkedPersonaIds: [], ...extra });

  it("a godparent with names alone is not proposed; with the same place, or the same work, it is", () => {
    expect(pair(godmother(), ana())).toBeLessThan(0.8);
    expect(pair(godmother({ places: ["Craiova"] }), ana())).toBeGreaterThanOrEqual(0.8);
    expect(pair(godmother({ occupations: ["moașă"] }), ana({ occupations: ["Moașă comunală"] }))).toBeGreaterThanOrEqual(0.8);
    expect(pair(godmother({ places: ["Ploiești"] }), ana())).toBeLessThan(0.8);            // a different place does not help
  });

  it("a witness with an agreeing stated age is proposed; the same place does not lift other roles", () => {
    const witness = godmother({ role: "witness", birth: [toJdn(1819, 6, 1), toJdn(1821, 6, 1)], alive: yr(1868) });
    expect(pair(witness, ana())).toBeGreaterThanOrEqual(0.8);
    const father = godmother({ role: "father", places: ["Craiova"] });
    expect(pair(father, ana({ sex: null }))).toBeLessThan(0.8);
  });
});
