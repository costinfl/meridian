import { freshStorage } from "./evidenceHelpers.js";
import { createEvidenceLibrary, fuzzyDate } from "../evidence/index.js";

/**
 * A small library and project for graph tests:
 *   - a death record 1866 (Șfatu Loti, deceased; informants Drăgoiescu and Cristescu with informantFor relations);
 *   - a baptism 1850 (child Ion Hariton; father Dumitru Hariton; godparent Ana Popescu, godparentOf; house 12 for both parents);
 *   - project people i1 Dumitru, i2 Ion (child of i1 and i3), i3 Maria; persona links: Dumitru accepted, Ion candidate.
 */
export async function graphFixture() {
  const library = createEvidenceLibrary(freshStorage());
  const src = await library.sources.create({ title: "Registre Craiova", kind: "civil-register" });
  const copy = (await library.copies.registerFile(new TextEncoder().encode("c"), { sourceId: src.id, storage: { mode: "blob", blobKey: "k" } })).copy;
  const p1 = await library.pages.addPage({ copyId: copy.id, pageIndex: 0, label: "32", width: 10, height: 10 });
  const p2 = await library.pages.addPage({ copyId: copy.id, pageIndex: 1, label: "33", width: 10, height: 10 });
  const run = await library.runs.startRun({ processor: "manual" });
  const rel = async (s, property, o, originalValue = "") => library.assertions.enterAsUser({ subjectType: "persona", subjectId: s.id, property, objectPersonaId: o.id, originalValue, runId: run.id, citation: { regionId: s.regionId ?? null, sourceId: src.id, pageLabel: "x" } });
  const death = await library.records.createRecord({ kind: "death", regionIds: [p1.wholePageRegion.id], runId: run.id, event: fuzzyDate({ year: 1866, month: 3, day: 26, calendar: "julian" }),
    personas: [{ nameAsWritten: "Șfatu Loti", role: "deceased" }, { nameAsWritten: "Alecsandru Drăgoiescu", role: "informant" }, { nameAsWritten: "Constandin Cristescu", role: "informant" }] });
  const [loti, drag, crist] = death.personas;
  await rel(drag, "informantFor", loti, "nepotu mortei");
  await rel(crist, "informantFor", loti, "vecin cu morta");
  const bapt = await library.records.createRecord({ kind: "baptism", regionIds: [p2.wholePageRegion.id], runId: run.id, event: fuzzyDate({ year: 1850, month: 5, day: 2, calendar: "julian" }),
    personas: [{ nameAsWritten: "Ion", role: "child" }, { nameAsWritten: "Dumitru Hariton", role: "father", houseNumber: "12" }, { nameAsWritten: "Maria", role: "mother", houseNumber: "12" }, { nameAsWritten: "Ana Popescu", role: "godparent" }] });
  const [ion, dum, mar, ana] = bapt.personas;
  await rel(ion, "childOf", dum); await rel(ion, "childOf", mar); await rel(ana, "godparentOf", ion);
  const people = [
    { id: "i1", name: "Dumitru Hariton", sex: "M" }, { id: "i2", name: "Ion Hariton", sex: "M" }, { id: "i3", name: "Maria Hariton", sex: "F" },
  ];
  const families = [{ id: "f1", partner1Id: "i1", partner2Id: "i3", children: [{ personId: "i2", order: 0 }], status: "accepted" }];
  const links = [
    { id: "L1", personId: "i1", personaId: dum.id, status: "accepted", score: null },
    { id: "L2", personId: "i2", personaId: ion.id, status: "candidate", score: 0.8 },
    { id: "L3", personId: "i3", personaId: ana.id, status: "rejected", score: 0.2 },
  ];
  return { library, src, copy, pages: { p1, p2 }, run, death, bapt, personas: { loti, drag, crist, ion, dum, mar, ana }, people, families, links, relationships: [] };
}
