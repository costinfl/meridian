import { describe, it, expect } from "vitest";
import { resolveFixture } from "./resolveHelpers.js";
import { personaProfiles, personProfiles, splitName } from "../resolve/profiles.js";
import { blockPairs, blockKeys, datesCompatible, placesCompatible, variantKeys } from "../resolve/blocking.js";
import { toJdn } from "../evidence/domain/fuzzyDate.js";

const setup = async () => {
  const fx = await resolveFixture();
  const snapshot = await fx.library.searchIndex.snapshot();
  const pp = personaProfiles(snapshot);
  const qp = personProfiles({ people: fx.people, families: fx.families, links: [], personaProfiles: pp });
  const key = Object.fromEntries(Object.entries(fx.personas).map(([k, p]) => [p.id, k]));
  return { fx, snapshot, pp, qp, key, id: (k) => fx.personas[k].id };
};
const yearOf = (day) => Math.floor((day - toJdn(0, 1, 1)) / 365.2425);

describe("Entity resolution profiles and blocking (P9.T1)", () => {
  it("names: surname, given names, maiden names", () => {
    expect(splitName("Maria Hariton (b. Văleanu)")).toEqual({ tokens: ["maria", "hariton"], given: ["maria"], surnames: ["hariton", "valeanu"] });
    expect(splitName("Ion")).toEqual({ tokens: ["ion"], given: ["ion"], surnames: [] });
  });

  it("persona profiles: borrowed surnames, sex from role, birth windows from age and role, relatives", async () => {
    const { pp, id } = await setup();
    const child = pp.get(id("b1850.child"));
    expect(child).toMatchObject({ surnames: ["hariton"], surnameFrom: "father", role: "child" });
    expect([yearOf(child.birth[0]), yearOf(child.birth[1])]).toEqual([1848, 1850]);
    expect(child.relatives.map((r) => [r.relation, r.name])).toEqual([["father", "Dumitru Hariton"], ["mother", "Maria"]]);
    const mother = pp.get(id("b1850.mother"));
    expect(mother).toMatchObject({ sex: "F", surnames: ["hariton"], surnameFrom: "husband" });
    const groom = pp.get(id("m1875.groom"));
    expect([yearOf(groom.birth[0]), yearOf(groom.birth[1])]).toEqual([1848, 1851]);   // 25 years ± 1 at 1875
    expect(groom.sex).toBe("M");
    expect(groom.relatives.map((r) => r.relation)).toEqual(["spouse"]);
    const dead = pp.get(id("d1890.deceased"));
    expect(dead.death).not.toBeNull();
    expect(dead.alive).toBeNull();
    expect(pp.get(id("d1890.informant")).alive).not.toBeNull();
    expect(dead.usesProposed).toBe(false);
  });

  it("person profiles: names of accepted personas are added, parents and spouses from families", async () => {
    const { fx, snapshot, id } = await setup();
    const pp = personaProfiles(snapshot);
    const qp = personProfiles({ people: fx.people, families: fx.families, links: [{ personId: "t3", personaId: id("b1877.father"), status: "accepted" }], personaProfiles: pp });
    const ion = qp.get("t3");
    expect(ion.given).toEqual(["ion", "iohannes"]);
    expect(ion.parents).toEqual(["t1", "t2"]);
    expect(ion.spouses).toEqual(["t4"]);
    expect(qp.get("t4").surnames).toEqual(["hariton", "baltaceanu"]);
  });

  it("block keys extend one step through name variants; dates and places", () => {
    const v = variantKeys([{ canonical: "Hariton", variant: "Haritonescu" }]);
    expect(blockKeys({ surnames: ["hariton"] }, v).length).toBeGreaterThan(blockKeys({ surnames: ["hariton"] }).length);
    expect(datesCompatible([0, 100], [200 + 3653, 300 + 3653], 10)).toBe(false);
    expect(datesCompatible([0, 100], [200, 300], 10)).toBe(true);
    expect(datesCompatible(null, [1, 2])).toBe(true);
    expect(placesCompatible({ places: ["Craiova"] }, { places: ["oraș Craiova, Dolj"] })).toBe(true);
    expect(placesCompatible({ places: ["Craiova"] }, { places: ["Ploiești"] })).toBe(false);
    expect(placesCompatible({ places: [] }, { places: ["Ploiești"] })).toBe(true);
    expect(placesCompatible({ placeId: "a", places: [] }, { placeId: "b", places: [] }, new Map([["a", new Set(["c"])], ["b", new Set(["c"])]]))).toBe(true);
  });

  it("pairs: the true matches are in the blocks, never two people of one record; counts reported; incremental", async () => {
    const { pp, qp, key, id, fx } = await setup();
    const { personPairs, personaPairs, counts } = blockPairs(pp, qp);
    const has = (k, t) => personPairs.some(([a, b]) => a === id(k) && b === t);
    for (const [k, t] of Object.entries(fx.truth)) if (t && !t.startsWith("group:")) expect(has(k, t), `${k} -> ${t}`).toBe(true);
    expect(personaPairs.some(([a, b]) => [key[a], key[b]].sort().join() === "b1850.godparent,m1875.witness")).toBe(true);
    for (const [a, b] of personaPairs) expect(pp.get(a).recordId).not.toBe(pp.get(b).recordId);
    expect(has("b1850.child", "t1")).toBe(false);                     // same surname, but born 30 years apart: dropped by date
    expect(has("b1877.father", "t1")).toBe(true);                     // same surname, windows meet: compared, scored later
    expect(counts.droppedByDate).toBeGreaterThan(0);
    expect(has("d1866.deceased", "t3")).toBe(false);                  // different surname
    expect(counts).toMatchObject({ personas: 16, pooled: 16, persons: 6 });
    expect(counts.personPairs).toBe(personPairs.length);
    expect(counts.rawPairs).toBe(counts.personPairs + counts.personaPairs + counts.droppedByDate);
    // accepted personas leave the pool; incremental runs only pair the personas asked for
    const accepted = new Set([id("b1850.child")]);
    expect(blockPairs(pp, qp, { acceptedPersonaIds: accepted }).personPairs.some(([a]) => a === id("b1850.child"))).toBe(false);
    const only = blockPairs(pp, qp, { onlyPersonaIds: new Set([id("d1890.deceased")]) });
    expect(new Set(only.personPairs.map(([a]) => a))).toEqual(new Set([id("d1890.deceased")]));
    expect(only.personaPairs.every(([a, b]) => a === id("d1890.deceased") || b === id("d1890.deceased"))).toBe(true);
  });
});
