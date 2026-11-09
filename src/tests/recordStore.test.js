import { describe, it, expect, beforeEach } from "vitest";
import { freshStorage } from "./evidenceHelpers.js";
import { createCopyStore } from "../evidence/repositories/copyStore.js";
import { createPageStore } from "../evidence/repositories/pageStore.js";
import { createRunStore } from "../evidence/repositories/runStore.js";
import { createPlaceStore } from "../evidence/repositories/placeStore.js";
import { createRecordStore } from "../evidence/repositories/recordStore.js";
import { createNameVariantStore } from "../evidence/repositories/nameVariantStore.js";
import { fuzzyDate, fuzzyDateFromIso, dayOf } from "../evidence/domain/fuzzyDate.js";

let storage, records, places, variants, runs, ctx;
beforeEach(async () => {
  storage = freshStorage();
  const copy = (await createCopyStore(storage).registerFile(new TextEncoder().encode("scan"), { storage: { mode: "blob", blobKey: "k" } })).copy;
  const pages = createPageStore(storage);
  runs = createRunStore(storage); places = createPlaceStore(storage); records = createRecordStore(storage); variants = createNameVariantStore(storage);
  const { page, wholePageRegion } = await pages.addPage({ copyId: copy.id, pageIndex: 0, width: 100, height: 100 });
  const row = await pages.addRegion({ pageId: page.id, box: { x0: 0, y0: 0.1, x1: 1, y1: 0.2 }, kind: "row" });
  const run = await runs.startRun({ processor: "manual" });
  const place = await places.createPlace();
  ctx = { page, whole: wholePageRegion, row, run, place };
});

const baptism = (extra = {}) => ({
  kind: "baptism", regionIds: [ctx.row.id], runId: ctx.run.id, placeId: ctx.place.id,
  event: fuzzyDateFromIso("1843-03-12", { asWritten: "12 Martie 1843", calendar: "julian" }),
  personas: [
    { nameAsWritten: "Ştefan Hariton", role: "child" },
    { nameAsWritten: "Dumitru Hariton", role: "father", occupation: "negustor", residence: "Ploiești", houseNumber: "14", statedAge: { value: 32, unit: "years", asWritten: "32 ani" } },
    { nameAsWritten: "Maria", role: "mother" },
    { nameAsWritten: "Ioan Văleanu", role: "godparent", regionId: ctx.row.id },
  ],
  ...extra,
});

describe("Record and Persona", () => {
  it("creates a baptism record with its personas as written, keyed and phonetically indexed", async () => {
    const { record, personas } = await records.createRecord(baptism());
    expect(await records.getRecord(record.id)).toEqual(record);
    expect(record).toMatchObject({ kind: "baptism", regionIds: [ctx.row.id], placeId: ctx.place.id, runId: ctx.run.id, eventEarliestDay: dayOf(1843, 3, 12, "julian") });
    expect(record.event.calendar).toBe("julian");
    expect(personas.map((p) => p.role)).toEqual(["child", "father", "mother", "godparent"]);
    const child = personas[0];
    expect(child).toMatchObject({ nameAsWritten: "Ştefan Hariton", nameKey: "stefan hariton", recordId: record.id });
    expect(child.surnameDm).toContain("593600"); // Hariton
    expect(child.surnameDm).toContain("276000"); // Stefan
    expect(personas[1]).toMatchObject({ occupation: "negustor", residence: "Ploiești", houseNumber: "14", statedAge: { value: 32, unit: "years", slack: 0, asWritten: "32 ani" } });
    expect((await records.personasOf(record.id)).map((p) => p.id).sort()).toEqual(personas.map((p) => p.id).sort());
  });

  it("finds personas by folded name and by phonetic code, and records by region, place and kind", async () => {
    const { record, personas } = await records.createRecord(baptism());
    expect((await records.findPersonasByName("ȘTEFAN HARITON")).map((p) => p.id)).toEqual([personas[0].id]);
    expect((await records.findPersonasByName("Stefan Hariton")).map((p) => p.id)).toEqual([personas[0].id]);
    const byDm = await records.findPersonasByDm("593600");
    expect(byDm.map((p) => p.nameAsWritten).sort()).toEqual(["Dumitru Hariton", "Ştefan Hariton"]);
    expect((await records.recordsByRegion(ctx.row.id)).map((r) => r.id)).toEqual([record.id]);
    expect(await records.recordsByRegion(ctx.whole.id)).toEqual([]);
    expect((await records.recordsByPlace(ctx.place.id)).map((r) => r.id)).toEqual([record.id]);
    expect((await records.recordsByKind("baptism"))).toHaveLength(1);
    expect((await records.recordsByKind("burial"))).toHaveLength(0);
  });

  it("queries records by event date range, across calendars", async () => {
    const mk = (iso, calendar = "gregorian") => records.createRecord({ kind: "burial", regionIds: [ctx.row.id], runId: ctx.run.id, event: fuzzyDateFromIso(iso, { calendar }) });
    const a = (await mk("1843-03-24")).record;            // Gregorian
    const b = (await mk("1843-03-12", "julian")).record;   // same day as a
    const c = (await mk("1850-06")).record;
    const d = (await mk("1900")).record;
    await records.createRecord({ kind: "census", regionIds: [ctx.row.id], runId: ctx.run.id }); // undated
    const ids = async (when) => (await records.recordsOverlapping(when)).map((r) => r.id).sort();
    expect(await ids("1843-03-24")).toEqual([a.id, b.id].sort());
    expect(await ids("1843")).toEqual([a.id, b.id].sort());
    expect(await ids("1850-06-15")).toEqual([c.id]);
    expect(await ids([dayOf(1840, 1, 1), dayOf(1860, 1, 1)])).toEqual([a.id, b.id, c.id].sort());
    expect(await ids(fuzzyDate({ year: 1899, modifier: "after" }))).toEqual([d.id]);
    expect(await ids("1700")).toEqual([]);
  });

  it("validates record input and references; failures leave nothing behind", async () => {
    const bad = async (patch, code) => { await expect(records.createRecord({ ...baptism(), ...patch })).rejects.toMatchObject({ code }); };
    await bad({ kind: "wedding" }, "invalid");
    await bad({ regionIds: [] }, "invalid");
    await bad({ regionIds: ["missing"] }, "not-found");
    await bad({ runId: "missing" }, "not-found");
    await bad({ runId: undefined }, "invalid");
    await bad({ placeId: "missing" }, "not-found");
    await bad({ event: { ...fuzzyDate({ year: 1850 }), earliest: "1851-01-01" } }, "invalid");
    await bad({ personas: [{ nameAsWritten: " ", role: "child" }] }, "invalid");
    await bad({ personas: [{ nameAsWritten: "X", role: "king" }] }, "invalid");
    await bad({ personas: [{ nameAsWritten: "X", statedAge: { value: -3 } }] }, "invalid");
    await bad({ personas: [{ nameAsWritten: "X", statedAge: { value: 3, unit: "weeks" } }] }, "invalid");
    await bad({ personas: [{ nameAsWritten: "X", regionId: "missing" }] }, "not-found");
    expect(await storage.dbCount("evRecords")).toBe(0);
    expect(await storage.dbCount("evPersonas")).toBe(0);
  });

  it("adds a later persona to an existing record and has no update/delete operations", async () => {
    const { record } = await records.createRecord(baptism());
    const w = await records.addPersona(record.id, { nameAsWritten: "Vasile Popescu", role: "witness" });
    expect((await records.personasOf(record.id))).toHaveLength(5);
    expect(w.recordId).toBe(record.id);
    await expect(records.addPersona("missing", { nameAsWritten: "X" })).rejects.toMatchObject({ code: "not-found" });
    expect(Object.keys(records).filter((k) => /^(update|delete|remove|set|put)/i.test(k))).toEqual([]);
  });
});

describe("NameVariant", () => {
  it("adds variants idempotently and expands one hop in both directions, never transitively", async () => {
    await variants.add({ canonical: "Ioan", variant: "Iohannes", language: "la" });
    await variants.add({ canonical: "Ioan", variant: "Ion", language: "ro" });
    await variants.add({ canonical: "Ioan", variant: "Jan", language: "pl", origin: "learned" });
    const again = await variants.add({ canonical: "ioan", variant: "ION" });
    expect(again.variant).toBe("Ion");
    expect(await variants.list()).toHaveLength(3);
    expect(await variants.expand("Ioan")).toEqual(["ioan", "ion", "iohannes", "jan"].sort()); // directly paired with Ioan
    expect(await variants.expand("Iohannes")).toEqual(["ioan", "iohannes"]);                  // finds its canonical, NOT Ion or Jan
    expect(await variants.expand("Ion")).toEqual(["ioan", "ion"]);
    expect(await variants.expand("Ştefan")).toEqual(["stefan"]); // unknown names expand to themselves
  });
  it("does not chain pairs: a person linked across archives under different names is a link decision, not a spelling rule", async () => {
    // Romanian archives (after 1918) vs Hungarian archives (before 1918): the same man appears as "Sfătu" and "Szvet".
    await variants.add({ canonical: "Sfătu", variant: "Szvet", language: "hu" });
    await variants.add({ canonical: "Szvet", variant: "Svet", language: "hu" });
    expect(await variants.expand("Sfătu")).toEqual(["sfatu", "szvet"]);
    expect(await variants.expand("Svet")).toEqual(["svet", "szvet"]);  // Sfătu is two hops away: not inferred
  });
  it("folds keys and validates input", async () => {
    const v = await variants.add({ canonical: "Ştefan", variant: "Stephan", language: "de" });
    expect(v).toMatchObject({ canonicalKey: "stefan", variantKey: "stephan" });
    expect(await variants.expand("Ștefan")).toEqual(["stefan", "stephan"]);
    await expect(variants.add({ canonical: "Stefan", variant: "Ștefan" })).rejects.toMatchObject({ code: "invalid" });
    await expect(variants.add({ canonical: "", variant: "x" })).rejects.toMatchObject({ code: "invalid" });
    await expect(variants.add({ canonical: "a", variant: "b", origin: "guess" })).rejects.toMatchObject({ code: "invalid" });
  });
});
