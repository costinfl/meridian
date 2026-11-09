import { describe, it, expect, beforeEach } from "vitest";
import { freshStorage } from "./evidenceHelpers.js";
import { createPlaceStore } from "../evidence/repositories/placeStore.js";
import { fuzzyDateFromIso, dayOf } from "../evidence/domain/fuzzyDate.js";
import { intervalOf, dayRangeOf } from "../evidence/domain/validity.js";

let storage, places;
beforeEach(() => { storage = freshStorage(); places = createPlaceStore(storage); });

describe("validity intervals", () => {
  it("covers whole periods and open ends", () => {
    const i = intervalOf("1859", "1918");
    expect(i.fromDay).toBe(dayOf(1859, 1, 1));
    expect(i.toDay).toBe(dayOf(1918, 12, 31));
    expect(intervalOf(null, "1859-03")).toMatchObject({ validFrom: null, toDay: dayOf(1859, 3, 31) });
    expect(() => intervalOf("1950", "1900")).toThrow(/validFrom/);
    expect(() => intervalOf("19xx")).toThrow(/ISO/);
  });
  it("accepts ISO dates, FuzzyDates, day numbers and ranges as 'when'", () => {
    expect(dayRangeOf("1885-03-01")).toEqual([dayOf(1885, 3, 1), dayOf(1885, 3, 1)]);
    expect(dayRangeOf(fuzzyDateFromIso("1885"))).toEqual([dayOf(1885, 1, 1), dayOf(1885, 12, 31)]);
    expect(dayRangeOf(2400000)).toEqual([2400000, 2400000]);
    expect(dayRangeOf([1, 2])).toEqual([1, 2]);
    expect(() => dayRangeOf({})).toThrow();
  });
});

describe("Place and PlaceName", () => {
  it("creates places with coordinates and external ids; validates kind and coordinates", async () => {
    const p = await places.createPlace({ kind: "settlement", coordinates: { lat: 44.94, lon: 26.02 }, geonamesId: 671768, wikidataId: "Q83449" });
    expect(await places.getPlace(p.id)).toEqual(p);
    await expect(places.createPlace({ kind: "planet" })).rejects.toMatchObject({ code: "invalid" });
    await expect(places.createPlace({ coordinates: { lat: 120, lon: 0 } })).rejects.toMatchObject({ code: "invalid" });
    expect((await places.updatePlace(p.id, { kind: "commune", id: "x" })).id).toBe(p.id);
  });

  // fixture: a city that changed name (and language) over time
  async function chisinau() {
    const p = await places.createPlace();
    await places.addName({ placeId: p.id, name: "Chișinău", language: "ro", validTo: "1812" });
    await places.addName({ placeId: p.id, name: "Кишинёв", language: "ru", validFrom: "1812", validTo: "1918" });
    await places.addName({ placeId: p.id, name: "Chişinău", language: "ro", validFrom: "1918" }); // cedilla spelling as found in a source
    await places.addName({ placeId: p.id, name: "Kishinev", language: "en", validFrom: "1812", validTo: "1991" });
    return p;
  }

  it("returns the names valid at a date, language preferred", async () => {
    const p = await chisinau();
    expect((await places.namesAt(p.id, "1800")).map((n) => n.name)).toEqual(["Chișinău"]);
    expect((await places.namesAt(p.id, "1885-03-01")).map((n) => n.name).sort()).toEqual(["Kishinev", "Кишинёв"]);
    expect((await places.nameAt(p.id, "1885-03-01", { language: "en" })).name).toBe("Kishinev");
    expect((await places.nameAt(p.id, "1885-03-01", { language: "ru" })).name).toBe("Кишинёв");
    expect((await places.namesAt(p.id, "1950")).map((n) => n.name).sort()).toEqual(["Chişinău", "Kishinev"]);
    expect((await places.namesAt(p.id, "2020")).map((n) => n.name)).toEqual(["Chişinău"]);
    expect((await places.nameAt(p.id, 1)).name).toBe("Chișinău"); // open start: valid since the beginning
    const q = await places.createPlace();
    await places.addName({ placeId: q.id, name: "Late name", validFrom: "1900" });
    expect(await places.nameAt(q.id, "1850")).toBeNull(); // before anything is recorded
    expect(await places.namesAt(p.id, "1812")).toHaveLength(3); // boundary year: old name, new names
  });
  it("uses year ranges and FuzzyDates (overlap semantics)", async () => {
    const p = await chisinau();
    const names = await places.namesAt(p.id, fuzzyDateFromIso("1811")); // all of 1811
    expect(names.map((n) => n.name)).toEqual(["Chișinău"]);
    expect((await places.namesAt(p.id, [dayOf(1811, 12, 1), dayOf(1812, 2, 1)])).length).toBe(3);
  });
  it("finds places by name regardless of case, accents and cedilla/comma forms", async () => {
    const p = await chisinau();
    for (const q of ["chisinau", "CHIȘINĂU", "Chişinau", "Kishinev"]) expect((await places.findByName(q)).map((x) => x.id)).toEqual([p.id]);
    expect(await places.findByName("Kishinev", "1800")).toEqual([]);          // that name did not exist yet
    expect((await places.findByName("Kishinev", "1900")).map((x) => x.id)).toEqual([p.id]);
    expect(await places.findByName("Nowhere")).toEqual([]);
  });
  it("validates names and intervals, and updates validity", async () => {
    const p = await places.createPlace();
    await expect(places.addName({ placeId: p.id, name: " " })).rejects.toMatchObject({ code: "invalid" });
    await expect(places.addName({ placeId: "missing", name: "X" })).rejects.toMatchObject({ code: "not-found" });
    await expect(places.addName({ placeId: p.id, name: "X", validFrom: "1900", validTo: "1800" })).rejects.toMatchObject({ code: "invalid" });
    const n = await places.addName({ placeId: p.id, name: "Ştefan cel Mare", validFrom: "1900" });
    expect(n.nameKey).toBe("stefan cel mare");
    const u = await places.updateName(n.id, { validTo: "1950" });
    expect(u.toDay).toBe(dayOf(1950, 12, 31));
    await expect(places.updateName(n.id, { validTo: "1800" })).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("PlaceParent: civil and church hierarchies over time", () => {
  // fixture based on the sample timeline: a village that moved between administrative units
  async function village() {
    const mk = async (name, kind) => { const p = await places.createPlace({ kind }); await places.addName({ placeId: p.id, name }); return p; };
    const v = await mk("Săhăteni", "settlement");
    const prahova = await mk("Județul Prahova", "county");
    const mizil = await mk("Raionul Mizil", "district");
    const regiunea = await mk("Regiunea Ploiești", "region");
    const buzau = await mk("Județul Buzău", "county");
    const ro = await mk("România", "country");
    await places.addParent({ childId: v.id, parentId: prahova.id, validFrom: "1925", validTo: "1949" });
    await places.addParent({ childId: v.id, parentId: mizil.id, validFrom: "1950", validTo: "1967" });
    await places.addParent({ childId: v.id, parentId: buzau.id, validFrom: "1968" });
    await places.addParent({ childId: mizil.id, parentId: regiunea.id, validFrom: "1950", validTo: "1967" });
    await places.addParent({ childId: regiunea.id, parentId: ro.id });
    await places.addParent({ childId: prahova.id, parentId: ro.id });
    await places.addParent({ childId: buzau.id, parentId: ro.id });
    return { v, prahova, mizil, regiunea, buzau, ro };
  }
  const names = async (list) => Promise.all(list.map(async (p) => (await places.namesOf(p.id))[0].name));

  it("gives the ancestors of a place at a date; the answer changes over time", async () => {
    const { v } = await village();
    expect(await names(await places.ancestorsAt(v.id, "1930"))).toEqual(["Județul Prahova", "România"]);
    expect(await names(await places.ancestorsAt(v.id, "1955"))).toEqual(["Raionul Mizil", "Regiunea Ploiești", "România"]);
    expect(await names(await places.ancestorsAt(v.id, "1970"))).toEqual(["Județul Buzău", "România"]);
    expect(await places.ancestorsAt(v.id, "1900")).toEqual([]); // nothing recorded yet
    expect((await places.parentAt(v.id, "1967-12-31")).id).not.toBe((await places.parentAt(v.id, "1968-01-01")).id);
  });
  it("lists the children of a unit at a date", async () => {
    const { buzau, prahova } = await village();
    expect(await names(await places.childrenAt(buzau.id, "1970"))).toEqual(["Săhăteni"]);
    expect(await places.childrenAt(buzau.id, "1930")).toEqual([]);
    expect(await names(await places.childrenAt(prahova.id, "1930"))).toEqual(["Săhăteni"]);
  });
  it("keeps civil and church hierarchies separate", async () => {
    const { v } = await village();
    const parish = await places.createPlace({ kind: "parish" });
    const protopopiat = await places.createPlace({ kind: "district" });
    await places.addParent({ childId: v.id, parentId: parish.id, hierarchy: "church", validFrom: "1800" });
    await places.addParent({ childId: parish.id, parentId: protopopiat.id, hierarchy: "church", validFrom: "1800" });
    expect((await places.ancestorsAt(v.id, "1930", "church")).map((p) => p.id)).toEqual([parish.id, protopopiat.id]);
    expect((await places.ancestorsAt(v.id, "1930", "civil")).map((p) => p.kind)).toEqual(["county", "country"]);
    await expect(places.addParent({ childId: v.id, parentId: parish.id, hierarchy: "other" })).rejects.toMatchObject({ code: "invalid" });
  });
  it("rejects overlapping parents, self-parenting, cycles, and unknown places", async () => {
    const { v, prahova, buzau, ro } = await village();
    await expect(places.addParent({ childId: v.id, parentId: buzau.id, validFrom: "1940", validTo: "1960" })).rejects.toMatchObject({ code: "conflict" });
    await expect(places.addParent({ childId: v.id, parentId: v.id })).rejects.toMatchObject({ code: "invalid" });
    await expect(places.addParent({ childId: ro.id, parentId: prahova.id })).rejects.toMatchObject({ code: "invariant" });  // România -> Prahova -> România
    await expect(places.addParent({ childId: ro.id, parentId: v.id, validFrom: "1930", validTo: "1931" })).rejects.toMatchObject({ code: "invariant" });
    await expect(places.addParent({ childId: "missing", parentId: ro.id })).rejects.toMatchObject({ code: "not-found" });
    await expect(places.addParent({ childId: ro.id, parentId: "missing" })).rejects.toMatchObject({ code: "not-found" });
    // a cycle that exists only at another time is allowed
    const x = await places.createPlace(), y = await places.createPlace();
    await places.addParent({ childId: x.id, parentId: y.id, validFrom: "1800", validTo: "1850" });
    await places.addParent({ childId: y.id, parentId: x.id, validFrom: "1900", validTo: "1950" });
    expect((await places.ancestorsAt(x.id, "1820")).map((p) => p.id)).toEqual([y.id]);
    expect((await places.ancestorsAt(y.id, "1920")).map((p) => p.id)).toEqual([x.id]);
  });
});
