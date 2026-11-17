import { describe, it, expect } from "vitest";
import { graphFixture } from "./graphHelpers.js";
import { buildTrackedGraph, updateGraph, canonical } from "../graph/index.js";
import { fuzzyDate } from "../evidence/index.js";

const inputsOf = async (fx, over = {}) => ({ snapshot: await fx.library.searchIndex.snapshot(), people: fx.people, families: fx.families, links: fx.links, relationships: fx.relationships, ...over });

describe("incremental graph updates (P8.T2, I7)", () => {
  it("after new records, relations, confirmations, rejections, links and family edits the updated graph equals a full rebuild", async () => {
    const fx = await graphFixture();
    let g = buildTrackedGraph(await inputsOf(fx));
    const { library, run, pages, personas } = fx;

    // a new record with a witness, on the baptism page
    const marriage = await library.records.createRecord({ kind: "marriage", regionIds: [pages.p2.wholePageRegion.id], runId: run.id, event: fuzzyDate({ year: 1875, calendar: "julian" }),
      personas: [{ nameAsWritten: "Ion Hariton", role: "groom" }, { nameAsWritten: "Elena", role: "bride" }, { nameAsWritten: "Ana Popescu", role: "witness" }] });
    const [groom, bride, witness] = marriage.personas;
    const llm = await library.runs.startRun({ processor: "llm-extraction" });
    const spouse = await library.assertions.propose({ subjectType: "persona", subjectId: groom.id, property: "spouseOf", objectPersonaId: bride.id, originalValue: "", runId: llm.id, citation: { regionId: pages.p2.wholePageRegion.id } });
    const wit = await library.assertions.propose({ subjectType: "persona", subjectId: witness.id, property: "witnessFor", objectPersonaId: groom.id, originalValue: "", runId: llm.id, citation: { regionId: pages.p2.wholePageRegion.id } });
    await library.assertions.confirmAssertion(spouse.id, { decidedBy: "user" });
    await library.assertions.rejectAssertion(wit.id, { decidedBy: "user" });
    // a relation added to an old record
    await library.assertions.propose({ subjectType: "persona", subjectId: personas.crist.id, property: "witnessFor", objectPersonaId: personas.loti.id, originalValue: "", runId: llm.id, citation: { regionId: pages.p1.wholePageRegion.id } });
    // project changes: a new person, a link accepted, a new family
    const people = [...fx.people, { id: "i4", name: "Elena Hariton", sex: "F" }];
    const links = [...fx.links.filter((l) => l.id !== "L2"), { id: "L2b", personId: "i2", personaId: personas.ion.id, status: "accepted", score: 0.8 }, { id: "L4", personId: "i4", personaId: bride.id, status: "candidate", score: 0.6 }];
    const families = [...fx.families, { id: "f2", partner1Id: "i2", partner2Id: "i4", children: [], status: "accepted" }];

    const inputs = await inputsOf(fx, { people, links, families });
    const r = updateGraph(g, inputs);
    expect(r.records).toBeGreaterThanOrEqual(2);
    expect(r.personLayer).toBe(true);
    expect(canonical(r.graph)).toEqual(canonical(buildTrackedGraph(inputs)));
    expect(r.graph.coOccurs.get(witness.id).find((e) => e.other === groom.id).relations).toEqual([]);      // rejected left out
    expect([...r.graph.partners.get("i2")]).toEqual(["i4"]);

    // nothing changed: nothing to do
    const again = updateGraph(r.graph, inputs);
    expect(again).toMatchObject({ records: 0, personLayer: false });
  });
});
