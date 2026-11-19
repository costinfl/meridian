import { freshStorage } from "./evidenceHelpers.js";
import { createEvidenceLibrary, fuzzyDate } from "../evidence/index.js";

/**
 * A small library and tree with known answers, for entity resolution tests (Phase 9). An invented family over three
 * generations, with the spelling of real registers (Ion / Ioan / Iohannes, Hariton / Haritonu, a wife named only
 * "Maria", a bride under her maiden name) and distractors (another Ion, an unrelated godmother who appears twice).
 *
 * Tree: t1 Dumitru Hariton (1820–1890) + t2 Maria Hariton (b. Văleanu, 1825) -> t3 Ion Hariton (1850);
 *       t3 + t4 Elena Hariton (b. Băltăceanu, 1855) -> t5 Gheorghe Hariton (1877); t6 Ion Popescu (1851), unrelated.
 * `truth`: persona key -> tree person id (or a group label for people not in the tree, or null).
 */
export async function resolveFixture() {
  const library = createEvidenceLibrary(freshStorage());
  const src = await library.sources.create({ title: "Registre Craiova", kind: "civil-register" });
  const copy = (await library.copies.registerFile(new TextEncoder().encode("r"), { sourceId: src.id, storage: { mode: "blob", blobKey: "k" } })).copy;
  const run = await library.runs.startRun({ processor: "manual" });
  let page = 0;
  const personas = {};
  const record = async (key, kind, date, people) => {
    const pg = await library.pages.addPage({ copyId: copy.id, pageIndex: page++, label: String(page), width: 10, height: 10 });
    const r = await library.records.createRecord({ kind, regionIds: [pg.wholePageRegion.id], runId: run.id, event: fuzzyDate({ ...date, calendar: "julian" }), personas: people.map(([, p]) => p) });
    r.personas.forEach((p, i) => { personas[`${key}.${people[i][0]}`] = p; });
    return r;
  };
  const age = (value) => ({ value, unit: "years", asWritten: `${value} ani` });
  await record("b1850", "baptism", { year: 1850, month: 5, day: 2 }, [
    ["child", { nameAsWritten: "Ion", role: "child" }], ["father", { nameAsWritten: "Dumitru Hariton", role: "father" }],
    ["mother", { nameAsWritten: "Maria", role: "mother" }], ["godparent", { nameAsWritten: "Ana Popescu", role: "godparent" }]]);
  await record("m1875", "marriage", { year: 1875, month: 10, day: 12 }, [
    ["groom", { nameAsWritten: "Ioan Haritonu", role: "groom", statedAge: age(25) }], ["bride", { nameAsWritten: "Elena Băltăceanu", role: "bride", statedAge: age(20) }],
    ["witness", { nameAsWritten: "Ana Popescu", role: "witness", statedAge: age(48) }]]);
  await record("b1877", "baptism", { year: 1877, month: 2, day: 20 }, [
    ["child", { nameAsWritten: "Gheorghe", role: "child" }], ["father", { nameAsWritten: "Iohannes Hariton", role: "father" }],
    ["mother", { nameAsWritten: "Elena", role: "mother" }]]);
  await record("d1890", "death", { year: 1890, month: 1, day: 8 }, [
    ["deceased", { nameAsWritten: "Dumitru Hariton", role: "deceased", statedAge: age(70) }], ["informant", { nameAsWritten: "Ion Hariton", role: "informant", statedAge: age(39) }]]);
  await record("d1866", "death", { year: 1866, month: 3, day: 28 }, [
    ["deceased", { nameAsWritten: "Șfatu Loti", role: "deceased", statedAge: age(62) }], ["informant", { nameAsWritten: "Constandin Cristescu", role: "informant" }]]);
  await record("b1852", "baptism", { year: 1852, month: 1, day: 15 }, [
    ["child", { nameAsWritten: "Ion", role: "child" }], ["father", { nameAsWritten: "Vasile Popescu", role: "father" }]]);

  const people = [
    { id: "t1", name: "Dumitru Hariton", sex: "M", birth: { year: 1820 }, death: { year: 1890 } },
    { id: "t2", name: "Maria Hariton (b. Văleanu)", sex: "F", birth: { year: 1825 }, death: {} },
    { id: "t3", name: "Ion Hariton", sex: "M", birth: { year: 1850 }, death: {} },
    { id: "t4", name: "Elena Hariton (b. Băltăceanu)", sex: "F", birth: { year: 1855 }, death: {} },
    { id: "t5", name: "Gheorghe Hariton", sex: "M", birth: { year: 1877 }, death: {} },
    { id: "t6", name: "Ion Popescu", sex: "M", birth: { year: 1851 }, death: {} },
  ];
  const families = [
    { id: "f1", partner1Id: "t1", partner2Id: "t2", children: [{ personId: "t3", order: 0 }], status: "accepted" },
    { id: "f2", partner1Id: "t3", partner2Id: "t4", children: [{ personId: "t5", order: 0 }], status: "accepted" },
  ];
  const truth = {
    "b1850.child": "t3", "b1850.father": "t1", "b1850.mother": "t2", "b1850.godparent": "group:ana",
    "m1875.groom": "t3", "m1875.bride": "t4", "m1875.witness": "group:ana",
    "b1877.child": "t5", "b1877.father": "t3", "b1877.mother": "t4",
    "d1890.deceased": "t1", "d1890.informant": "t3",
    "d1866.deceased": null, "d1866.informant": null,
    "b1852.child": "t6", "b1852.father": null,
  };
  return { library, src, copy, run, personas, people, families, truth };
}
