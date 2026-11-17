import { describe, it, expect } from "vitest";
import { graphFixture } from "./graphHelpers.js";
import { buildGraph, canonical } from "../graph/index.js";

const build = async (fx) => buildGraph({ snapshot: await fx.library.searchIndex.snapshot(), people: fx.people, families: fx.families, links: fx.links, relationships: fx.relationships });

describe("graph projection (P8.T1)", () => {
  it("records, personas with roles, co-occurrence with stated relations and same house", async () => {
    const fx = await graphFixture();
    const g = await build(fx);
    const { loti, drag, crist, ion, dum, mar, ana } = fx.personas;
    expect(g.records.get(fx.death.record.id)).toMatchObject({ kind: "death", dateText: "", sourceId: fx.src.id, pageLabel: "32", personaIds: expect.arrayContaining([loti.id, drag.id, crist.id]) });
    expect(g.records.get(fx.death.record.id).earliestDay).toBe(fx.death.record.event.earliestDay);
    expect(g.personas.get(drag.id)).toMatchObject({ role: "informant", recordId: fx.death.record.id });
    const dragEdges = g.coOccurs.get(drag.id);
    expect(dragEdges.map((e) => e.other).sort()).toEqual([crist.id, loti.id].sort());
    expect(dragEdges.find((e) => e.other === loti.id).relations).toEqual([{ property: "informantFor", from: drag.id, to: loti.id, originalValue: "nepotu mortei", status: "confirmed" }]);
    expect(dragEdges.find((e) => e.other === crist.id).relations).toEqual([]);
    expect(g.coOccurs.get(dum.id).find((e) => e.other === mar.id).sameHouse).toBe(true);
    expect(g.coOccurs.get(ana.id).find((e) => e.other === ion.id).relations[0].property).toBe("godparentOf");
    expect(g.coOccurs.get(loti.id).some((e) => e.recordId === fx.bapt.record.id)).toBe(false);   // records do not mix
  });

  it("persons, families, and links: accepted and candidate kept, rejected left out", async () => {
    const fx = await graphFixture();
    const g = await build(fx);
    expect(g.parents.get("i2").sort()).toEqual(["i1", "i3"]);
    expect(g.children.get("i1")).toEqual(["i2"]);
    expect([...g.partners.get("i1")]).toEqual(["i3"]);
    expect(g.personaLinks.get(fx.personas.dum.id)).toEqual([{ personId: "i1", personaId: fx.personas.dum.id, status: "accepted", score: null, linkId: "L1" }]);
    expect(g.personaLinks.get(fx.personas.ion.id)[0].status).toBe("candidate");
    expect(g.personaLinks.has(fx.personas.ana.id)).toBe(false);
  });

  it("rejected relation assertions are left out; a rebuild is identical", async () => {
    const fx = await graphFixture();
    const relA = (await fx.library.assertions.listBySubject(fx.personas.ana.id)).find((a) => a.property === "godparentOf");
    // decisions apply to proposals; supersede the godparent claim by a user correction that is then rejected is not allowed,
    // so propose a second relation and reject it
    const run = await fx.library.runs.startRun({ processor: "llm-extraction" });
    const p = await fx.library.assertions.propose({ subjectType: "persona", subjectId: fx.personas.ana.id, property: "witnessFor", objectPersonaId: fx.personas.ion.id, originalValue: "", runId: run.id, citation: { regionId: fx.pages.p2.wholePageRegion.id } });
    await fx.library.assertions.rejectAssertion(p.id, { decidedBy: "user" });
    const g = await build(fx);
    expect(g.coOccurs.get(fx.personas.ana.id).find((e) => e.other === fx.personas.ion.id).relations.map((r) => r.property)).toEqual(["godparentOf"]);
    expect(relA).toBeTruthy();
    expect(canonical(await build(fx))).toEqual(canonical(g));
  });
});
