import { describe, it, expect, beforeEach } from "vitest";
import { freshStorage } from "./evidenceHelpers.js";
import { createEvidenceLibrary } from "../evidence/index.js";
import { fuzzyDateFromIso, fuzzyDate, overlaps } from "../evidence/domain/fuzzyDate.js";

let lib, ctx;
beforeEach(async () => {
  const storage = freshStorage(); lib = createEvidenceLibrary(storage);
  const src = await lib.sources.create({ kind: "parish-register", title: "Botezuri 1843" });
  const copy = (await lib.copies.registerFile(new TextEncoder().encode("scan"), { sourceId: src.id, storage: { mode: "blob", blobKey: "k" } })).copy;
  const { page } = await lib.pages.addPage({ copyId: copy.id, pageIndex: 0, width: 100, height: 100 });
  const row = await lib.pages.addRegion({ pageId: page.id, box: { x0: 0, y0: 0.1, x1: 1, y1: 0.2 }, kind: "row" });
  const llm = await lib.runs.startRun({ processor: "llm-extraction" });
  const manual = await lib.runs.startRun({ processor: "manual" });
  const { record, personas } = await lib.records.createRecord({
    kind: "baptism", regionIds: [row.id], runId: llm.id, event: fuzzyDateFromIso("1885-03-01"),
    personas: [
      { nameAsWritten: "Ştefan Hariton", role: "child", occupation: "ucenic" },
      { nameAsWritten: "Dumitru Hariton", role: "father", statedAge: { value: 45, unit: "years", asWritten: "45 ani" } },
    ],
  });
  ctx = { src, row, llm, manual, record, child: personas[0], father: personas[1] };
});
const claim = (persona, property, originalValue, extra = {}) => ({ subjectType: "persona", subjectId: persona.id, property, originalValue, runId: ctx.llm.id, citation: { regionId: ctx.row.id }, ...extra });
const confirmed = async (persona, property, value, extra = {}) => lib.assertions.confirmAssertion((await lib.assertions.propose(claim(persona, property, value, extra))).id, { decidedBy: "u" });

describe("personaView (P3.T7)", () => {
  it("is built from current confirmed assertions only; proposals are listed as pending", async () => {
    await confirmed(ctx.child, "name", "Ştefan Hariton");
    await confirmed(ctx.child, "occupation", "ucenic");
    const pending = await lib.assertions.propose(claim(ctx.child, "residence", "Ploiești"));
    const view = await lib.personaView.forPersona(ctx.child.id);
    expect(view.facts.name).toMatchObject({ original: "Ştefan Hariton", normalized: "Ștefan Hariton", agent: "llm-extraction", decidedBy: "u" });
    expect(view.facts.occupation.normalized).toBe("ucenic");
    expect(view.facts.residence).toBeUndefined();   // only proposed
    expect(view.pending).toEqual([pending.id]);
    expect(view.name).toBe("Ștefan Hariton");
    expect(view.asWritten).toMatchObject({ nameAsWritten: "Ştefan Hariton", role: "child", occupation: "ucenic" });
  });

  it("excludes rejected and superseded assertions", async () => {
    const rejected = await lib.assertions.propose(claim(ctx.child, "occupation", "hoț"));
    await lib.assertions.rejectAssertion(rejected.id, { decidedBy: "u" });
    const old = await confirmed(ctx.child, "name", "Stefan Haritan");
    const fixed = await lib.assertions.enterAsUser(claim(ctx.child, "name", "Ştefan Hariton", { runId: ctx.manual.id, supersedesId: old.id }));
    const view = await lib.personaView.forPersona(ctx.child.id);
    expect(view.facts.occupation).toBeUndefined();
    expect(view.facts.name.assertionId).toBe(fixed.id);
    expect(view.facts.name.original).toBe("Ştefan Hariton");
    expect(view.conflicts).toEqual({});
    expect(view.pending).toEqual([]);
  });

  it("a superseded proposal does not show up as pending either", async () => {
    const p1 = await lib.assertions.propose(claim(ctx.child, "residence", "Ploiesti"));
    const p2 = await lib.assertions.propose(claim(ctx.child, "residence", "Ploiești", { supersedesId: p1.id }));
    expect((await lib.personaView.forPersona(ctx.child.id)).pending).toEqual([p2.id]);
  });

  it("shows the newest confirmed value and lists conflicting confirmed values instead of merging them", async () => {
    const a = await confirmed(ctx.father, "occupation", "negustor");
    const b = await confirmed(ctx.father, "occupation", "proprietar");
    const same = await confirmed(ctx.father, "residence", "Ploiești");
    await confirmed(ctx.father, "residence", "Ploiești"); // same value twice: not a conflict
    const view = await lib.personaView.forPersona(ctx.father.id);
    expect(view.facts.occupation.assertionId).toBe(b.id);
    expect(view.conflicts.occupation.sort()).toEqual([a.id, b.id].sort());
    expect(view.conflicts.residence).toBeUndefined();
    expect(same.status).toBe("confirmed");
  });

  it("folds confirmed relations (both directions) and ignores unconfirmed ones", async () => {
    const rel = (subject, object, property) => lib.assertions.propose({ subjectType: "persona", subjectId: subject.id, property, originalValue: "", objectPersonaId: object.id, runId: ctx.llm.id, citation: { regionId: ctx.row.id } });
    const parent = await rel(ctx.father, ctx.child, "parentOf");
    await lib.assertions.confirmAssertion(parent.id, { decidedBy: "u" });
    await rel(ctx.child, ctx.father, "childOf"); // still proposed
    const father = await lib.personaView.forPersona(ctx.father.id);
    const child = await lib.personaView.forPersona(ctx.child.id);
    expect(father.relations).toEqual([{ property: "parentOf", subjectPersonaId: ctx.father.id, objectPersonaId: ctx.child.id, assertionId: parent.id }]);
    expect(child.relations).toEqual([]);
    expect(child.relationsIn.map((r) => r.assertionId)).toEqual([parent.id]);
    expect(child.pending).toHaveLength(1);
  });

  it("derives a birth range from the stated age (never stored) until a birth date is confirmed", async () => {
    const view = await lib.personaView.forPersona(ctx.father.id);
    expect(view.derived.birthRange).toMatchObject({ earliest: "1839-03-02", latest: "1840-03-01", derivedFrom: "computed", asWritten: "45 ani" });
    // a confirmed age assertion takes over from the as-written age
    await confirmed(ctx.father, "age", "46 ani", { normalizedValue: { value: 46 } });
    expect((await lib.personaView.forPersona(ctx.father.id)).derived.birthRange).toMatchObject({ earliest: "1838-03-02", latest: "1839-03-01" });
    // a confirmed birth date wins; no derived range is shown
    await confirmed(ctx.father, "birth.date", "12 Nov 1839", { normalizedValue: fuzzyDate({ year: 1839, month: 11, day: 12 }) });
    const done = await lib.personaView.forPersona(ctx.father.id);
    expect(done.derived.birthRange).toBeNull();
    expect(overlaps(done.facts["birth.date"].normalized, fuzzyDateFromIso("1839-11-12"))).toBe(true);
    expect((await lib.personaView.forPersona(ctx.child.id)).derived.birthRange).toBeNull(); // no age, nothing to derive
  });

  it("a role confirmed by assertion overrides the as-written role; forRecord lists every persona; unknown id fails", async () => {
    await confirmed(ctx.child, "role", "child");
    const views = await lib.personaView.forRecord(ctx.record.id);
    expect(views.map((v) => v.personaId).sort()).toEqual([ctx.child.id, ctx.father.id].sort());
    expect(views.find((v) => v.personaId === ctx.child.id).role).toBe("child");
    expect(views.find((v) => v.personaId === ctx.father.id).role).toBe("father");
    await expect(lib.personaView.forPersona("missing")).rejects.toMatchObject({ code: "not-found" });
  });
});
