import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { freshStorage } from "./evidenceHelpers.js";
import { createEvidenceLibrary, buildManualRecord, saveManualRecord, suggestRelations, writeRecords, boxInParent, toEvidence } from "../evidence/index.js";

let library, page, whole;
beforeEach(async () => {
  library = createEvidenceLibrary(freshStorage());
  const copy = (await library.copies.registerFile(new TextEncoder().encode("p32"), { storage: { mode: "blob", blobKey: "k" } })).copy;
  ({ page, wholePageRegion: whole } = await library.pages.addPage({ copyId: copy.id, pageIndex: 0, width: 1475, height: 2320 }));
});

const DEATH_FORM = {
  kind: "death",
  eventDate: { asWritten: "26 Martie 1866, 11 ore noaptea", year: "1866", month: "3", day: "26", calendar: "" },
  eventPlace: "Craiova",
  personas: [
    { key: "p1", nameAsWritten: "Șfatu Loti", role: "deceased", sex: "female", ageAsWritten: "șaizeci și doi ani", ageValue: "62", religion: "Catolică", residence: "Craiova" },
    { key: "p2", nameAsWritten: "Alecsandru Drăgoiescu", role: "informant", occupation: "profesoru" },
    { key: "p3", nameAsWritten: "Constandin Cristescu", role: "informant", ageValue: "32", occupation: "profesoru" },
    { key: "p4", nameAsWritten: "  ", role: "witness" },
  ],
  relations: [{ subject: "p2", property: "informantFor", object: "p1", asWritten: "nepotu mortei" }, { subject: "p3", property: "informantFor", object: "p1" }],
};

describe("manual entry (P6.T2)", () => {
  it("suggests relations from roles", () => {
    expect(suggestRelations([{ key: "c", role: "child" }, { key: "f", role: "father" }, { key: "m", role: "mother" }, { key: "g", role: "godparent" }])).toEqual([
      { subject: "c", property: "childOf", object: "f" }, { subject: "c", property: "childOf", object: "m" }, { subject: "g", property: "godparentOf", object: "c" },
    ]);
    expect(suggestRelations([{ key: "a", role: "informant" }, { key: "d", role: "deceased" }, { key: "x", role: "groom" }, { key: "y", role: "bride" }])).toEqual([
      { subject: "x", property: "spouseOf", object: "y" }, { subject: "a", property: "informantFor", object: "d" },
    ]);
  });

  it("builds contract output from the form: trims, drops empty rows, parses numbers", () => {
    const out = buildManualRecord(DEATH_FORM);
    expect(out.records[0]).toMatchObject({ kind: "death", eventDate: { asWritten: "26 Martie 1866, 11 ore noaptea", year: 1866, month: 3, day: 26 }, eventPlace: "Craiova" });
    expect(out.records[0].personas).toHaveLength(3);
    expect(out.records[0].personas[0]).toEqual({ key: "p1", nameAsWritten: "Șfatu Loti", role: "deceased", sex: "female", age: { asWritten: "șaizeci și doi ani", value: 62, unit: "years" }, residence: "Craiova", religion: "Catolică" });
    expect(out.records[0].personas[2].age).toEqual({ asWritten: "32", value: 32, unit: "years" });
    expect(out.records[0].relations).toEqual([{ subject: "p2", property: "informantFor", object: "p1", asWritten: "nepotu mortei" }, { subject: "p3", property: "informantFor", object: "p1" }]);
  });

  it("saves the record on a drawn region with every claim confirmed by a manual run", async () => {
    const region = await library.pages.addRegion({ pageId: page.id, parentRegionId: whole.id, box: { x0: 0.08, y0: 0.13, x1: 0.95, y1: 0.73 }, kind: "block" });
    const r = await saveManualRecord({ library, regionId: region.id, form: DEATH_FORM });
    expect(r.record).toMatchObject({ kind: "death", regionIds: [region.id] });
    expect(r.record.event).toMatchObject({ earliest: "1866-03-26", calendar: "julian" });
    expect(r.personas.map((p) => p.nameAsWritten)).toEqual(["Șfatu Loti", "Alecsandru Drăgoiescu", "Constandin Cristescu"]);
    expect(await library.runs.getRun(r.runId)).toMatchObject({ processor: "manual", status: "succeeded", schemaVersion: "1" });
    const all = await Promise.all(r.assertions.map((a) => library.assertions.get(a.id)));
    expect(all.every((a) => a.status === "confirmed" && a.agent === "manual" && a.citation.regionId === region.id)).toBe(true);
    const props = all.map((a) => a.property);
    expect(props).toEqual(expect.arrayContaining(["event.date", "event.place", "name", "age", "x-religion", "informantFor"]));
    const rel = all.find((a) => a.property === "informantFor" && a.originalValue === "nepotu mortei");
    expect(rel.objectPersonaId).toBe(r.personas[0].id);
    expect(rel.subjectId).toBe(r.personas[1].id);
  });

  it("refuses a form without people, or with an impossible date, and writes nothing", async () => {
    await expect(saveManualRecord({ library, regionId: whole.id, form: { kind: "death", personas: [] } })).rejects.toThrow(/at least one person/);
    await expect(saveManualRecord({ library, regionId: whole.id, form: { ...DEATH_FORM, eventDate: { year: "1866", month: "2", day: "30" } } })).rejects.toThrow(/day out of range/);
    expect(await library.records.recordsByRegion(whole.id)).toEqual([]);
    expect(await library.runs.listRuns()).toEqual([]);
  });
});

describe("writeRecords", () => {
  it("maps a box given inside a region to page coordinates", () => {
    expect(boxInParent({ x0: 0.1, y0: 0.2, x1: 0.5, y1: 0.6 }, { x0: 0.5, y0: 0, x1: 1, y1: 0.5 })).toEqual({ x0: 0.3, y0: 0.2, x1: 0.5, y1: 0.4 });
  });

  it("an extractor's output is written as proposals; a boxed record gets a child region; skipped claims are counted", async () => {
    const out = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "extraction", "death-1866.json"), "utf8"));
    const run = await library.runs.startRun({ processor: "llm-extraction" });
    const r = await writeRecords({ library, runId: run.id, regionId: whole.id, records: toEvidence(out),
      addAssertion: (input) => library.assertions.propose(input),
      skip: async ({ property }) => property === "x-religion" });
    expect(r.skipped).toBe(1);
    const [{ record, assertions }] = r.written;
    const child = await library.pages.getRegion(record.regionIds[0]);
    expect(child).toMatchObject({ parentRegionId: whole.id, kind: "block", box: { x0: 0.05, y0: 0.08, x1: 0.97, y1: 0.72 } });
    const stored = await Promise.all(assertions.map((a) => library.assertions.get(a.id)));
    expect(stored.every((a) => a.status === "proposed" && a.agent === "llm-extraction" && a.confidence === 0.7)).toBe(true);
  });
});
