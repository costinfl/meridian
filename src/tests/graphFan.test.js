import { describe, it, expect } from "vitest";
import { graphFixture } from "./graphHelpers.js";
import { buildGraph, fanOf, candidateClusters } from "../graph/index.js";

async function setup(over = {}) {
  const fx = await graphFixture();
  const inputs = { snapshot: await fx.library.searchIndex.snapshot(), people: fx.people, families: fx.families, links: fx.links, relationships: fx.relationships, ...over(fx) };
  return { fx, g: buildGraph(inputs) };
}
const noOver = () => ({});

describe("FAN queries (P8.T3)", () => {
  it("a person's records with the others, their roles, the relations stated and who they are", async () => {
    const { fx, g } = await setup(noOver);
    const f = fanOf(g, { personId: "i1" });                                           // Dumitru: father at the 1850 baptism
    expect(f.entries).toHaveLength(1);
    const e = f.entries[0];
    expect(e).toMatchObject({ record: { kind: "baptism" }, self: { role: "father" }, link: { status: "accepted" } });
    const byRole = Object.fromEntries(e.others.map((o) => [o.persona.role, o]));
    expect(Object.keys(byRole).sort()).toEqual(["child", "godparent", "mother"]);
    expect(byRole.child.relations).toEqual([expect.objectContaining({ property: "childOf", direction: "theirs" })]);
    expect(byRole.child.persons).toEqual([{ personId: "i2", name: "Ion Hariton", status: "candidate", score: 0.8 }]);   // "possible"
    expect(byRole.mother.sameHouse).toBe(true);
    expect(byRole.godparent.persons).toEqual([]);                                     // its only link was rejected
  });

  it("from a persona: the informants of the 1866 death, with the words that state the relation", async () => {
    const { fx, g } = await setup(noOver);
    const e = fanOf(g, { personaId: fx.personas.loti.id }).entries[0];
    expect(e.others.map((o) => [o.persona.nameAsWritten, o.relations[0]?.originalValue])).toEqual([["Alecsandru Drăgoiescu", "nepotu mortei"], ["Constandin Cristescu", "vecin cu morta"]]);
  });

  it("filters by role and years; a candidate-linked record counts as possible; two steps are bounded and skip seen persons", async () => {
    const { fx, g } = await setup(noOver);
    expect(fanOf(g, { personId: "i1", roles: ["godparent"] }).entries).toHaveLength(1);
    expect(fanOf(g, { personId: "i1", roles: ["witness"] }).entries).toHaveLength(0);
    expect(fanOf(g, { personId: "i1", fromYear: 1860, toYear: 1870 }).entries).toHaveLength(0);
    expect(fanOf(g, { personId: "i2" }).possible).toBe(1);
    // accept Ion's link, then two steps from Ion reach Dumitru's records (none new: the same baptism is visited once)
    const { g: g2 } = await setup((f) => ({ links: [...f.links.filter((l) => l.id !== "L2"), { id: "L2b", personId: "i2", personaId: f.personas.ion.id, status: "accepted" }] }));
    const two = fanOf(g2, { personId: "i2", hops: 2 });
    expect(two.entries).toHaveLength(1);
    expect(two.second).toEqual([]);                                                    // Dumitru's only record is this one
    expect(fx).toBeTruthy();
  });

  it("two steps: the associates' own records, once each", async () => {
    const fx = await graphFixture();
    const { fuzzyDate } = await import("../evidence/index.js");
    const later = await fx.library.records.createRecord({ kind: "baptism", regionIds: [fx.pages.p2.wholePageRegion.id], runId: fx.run.id, event: fuzzyDate({ year: 1870, calendar: "julian" }),
      personas: [{ nameAsWritten: "Elena Drăgoiescu", role: "child" }, { nameAsWritten: "Alecsandru Drăgoiescu", role: "father" }] });
    const links = [...fx.links, { id: "L6", personId: "i6", personaId: fx.personas.loti.id, status: "accepted" },
      { id: "L7", personId: "i5", personaId: fx.personas.drag.id, status: "accepted" }, { id: "L8", personId: "i5", personaId: later.personas[1].id, status: "accepted" }];
    const people = [...fx.people, { id: "i5", name: "Alexandru Drăgoiescu", sex: "M" }, { id: "i6", name: "Loti Șfatu", sex: "F" }];
    const g = buildGraph({ snapshot: await fx.library.searchIndex.snapshot(), people, families: fx.families, links, relationships: [] });
    const one = fanOf(g, { personId: "i6" });
    expect(one.second).toEqual([]);
    const two = fanOf(g, { personId: "i6", hops: 2 });
    expect(two.entries.map((e) => e.record.kind)).toEqual(["death"]);
    expect(two.second).toHaveLength(1);
    expect(two.second[0]).toMatchObject({ person: { name: "Alexandru Drăgoiescu" }, via: { nameAsWritten: "Alecsandru Drăgoiescu" } });
    expect(two.second[0].entries.map((e) => [e.record.kind, e.self.role])).toEqual([["baptism", "father"]]);
    expect(two.second[0].status).toBe("accepted");
    expect(two.possible).toBe(0);
  });

  it("two steps also follow candidate links, marked possible and listed after accepted ones; rejected never", async () => {
    const fx = await graphFixture();
    const { fuzzyDate } = await import("../evidence/index.js");
    const later = await fx.library.records.createRecord({ kind: "baptism", regionIds: [fx.pages.p2.wholePageRegion.id], runId: fx.run.id, event: fuzzyDate({ year: 1870, calendar: "julian" }),
      personas: [{ nameAsWritten: "Elena Drăgoiescu", role: "child" }, { nameAsWritten: "Alecsandru Drăgoiescu", role: "father" }] });
    const burial = await fx.library.records.createRecord({ kind: "burial", regionIds: [fx.pages.p2.wholePageRegion.id], runId: fx.run.id, event: fuzzyDate({ year: 1880, calendar: "julian" }),
      personas: [{ nameAsWritten: "C. Cristescu", role: "deceased" }] });
    const links = [...fx.links, { id: "L6", personId: "i6", personaId: fx.personas.loti.id, status: "accepted" },
      { id: "L7", personId: "i5", personaId: fx.personas.drag.id, status: "candidate", score: 0.6 }, { id: "L8", personId: "i5", personaId: later.personas[1].id, status: "accepted" },
      { id: "L9", personId: "i7", personaId: fx.personas.crist.id, status: "accepted" }, { id: "L10", personId: "i7", personaId: burial.personas[0].id, status: "accepted" }];
    const people = [...fx.people, { id: "i5", name: "Alexandru Drăgoiescu", sex: "M" }, { id: "i6", name: "Loti Șfatu", sex: "F" }, { id: "i7", name: "Constantin Cristescu", sex: "M" }];
    const g = buildGraph({ snapshot: await fx.library.searchIndex.snapshot(), people, families: fx.families, links, relationships: [] });
    const two = fanOf(g, { personId: "i6", hops: 2 });
    expect(two.second.map((s) => [s.person.name, s.status, s.entries[0].record.kind])).toEqual([
      ["Constantin Cristescu", "accepted", "burial"], ["Alexandru Drăgoiescu", "candidate", "baptism"]]);
    expect(two.possible).toBe(1);
    // rejected: never followed
    const g2 = buildGraph({ snapshot: await fx.library.searchIndex.snapshot(), people, families: fx.families, links: links.map((l) => (l.id === "L7" ? { ...l, status: "rejected" } : l)), relationships: [] });
    expect(fanOf(g2, { personId: "i6", hops: 2 }).second.map((s) => s.person.name)).toEqual(["Constantin Cristescu"]);
  });

  it("candidate clusters: personas and persons tied by candidate links", async () => {
    const { fx, g } = await setup((f) => ({ links: [...f.links, { id: "L5", personId: "i2", personaId: f.personas.drag.id, status: "candidate", score: 0.3 }] }));
    expect(candidateClusters(g)).toEqual([{ personIds: ["i2"], personaIds: [fx.personas.drag.id, fx.personas.ion.id].sort() }]);
  });
});
