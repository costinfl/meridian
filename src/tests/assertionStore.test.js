import { describe, it, expect, beforeEach } from "vitest";
import { freshStorage } from "./evidenceHelpers.js";
import { createEvidenceLibrary } from "../evidence/index.js";
import { fuzzyDateFromIso, fromStatedAge } from "../evidence/domain/fuzzyDate.js";

let storage, lib, ctx;
beforeEach(async () => {
  storage = freshStorage(); lib = createEvidenceLibrary(storage);
  const src = await lib.sources.create({ kind: "parish-register", title: "Botezuri 1843" });
  const copy = (await lib.copies.registerFile(new TextEncoder().encode("scan"), { sourceId: src.id, storage: { mode: "blob", blobKey: "k" } })).copy;
  const { page, wholePageRegion } = await lib.pages.addPage({ copyId: copy.id, pageIndex: 0, width: 100, height: 100 });
  const row = await lib.pages.addRegion({ pageId: page.id, box: { x0: 0, y0: 0.1, x1: 1, y1: 0.2 }, kind: "row" });
  const llm = await lib.runs.startRun({ processor: "llm-extraction", modelId: "m", schemaVersion: "extract-1" });
  const manual = await lib.runs.startRun({ processor: "manual" });
  const imp = await lib.runs.startRun({ processor: "import" });
  const { record, personas } = await lib.records.createRecord({
    kind: "baptism", regionIds: [row.id], runId: llm.id,
    event: fuzzyDateFromIso("1843-03-12", { calendar: "julian" }),
    personas: [{ nameAsWritten: "Ştefan Hariton", role: "child" }, { nameAsWritten: "Dumitru Hariton", role: "father" }],
  });
  ctx = { src, page, whole: wholePageRegion, row, llm, manual, imp, record, child: personas[0], father: personas[1] };
});

const nameClaim = (over = {}) => ({ subjectType: "persona", subjectId: ctx.child.id, property: "name", originalValue: "Ştefan Hariton", runId: ctx.llm.id, citation: { regionId: ctx.row.id }, confidence: 0.9, ...over });

describe("Assertion: creation and citation rules (I2, I3)", () => {
  it("an extraction proposes an assertion with original and normalised values, agent from its run", async () => {
    const a = await lib.assertions.propose(nameClaim());
    expect(a).toMatchObject({ status: "proposed", agent: "llm-extraction", runId: ctx.llm.id, originalValue: "Ştefan Hariton", normalizedValue: "Ștefan Hariton", confidence: 0.9, citationRegionId: ctx.row.id, decidedBy: null, supersedesId: null });
    expect(await lib.assertions.get(a.id)).toEqual(a);
    expect((await lib.assertions.listBySubject(ctx.child.id)).map((x) => x.id)).toEqual([a.id]);
    expect((await lib.assertions.listByRegion(ctx.row.id))).toHaveLength(1);
    expect((await lib.assertions.listByRun(ctx.llm.id))).toHaveLength(1);
  });

  it("I2: non-manual, non-import agents must cite an existing region", async () => {
    await expect(lib.assertions.propose(nameClaim({ citation: {} }))).rejects.toMatchObject({ code: "invalid" });
    await expect(lib.assertions.propose(nameClaim({ citation: { sourceId: ctx.src.id, pageLabel: "f. 1" } }))).rejects.toMatchObject({ code: "invalid" });
    await expect(lib.assertions.propose(nameClaim({ citation: { regionId: "missing" } }))).rejects.toMatchObject({ code: "not-found" });
    expect(await storage.dbCount("evAssertions")).toBe(0);
  });
  it("I2 exceptions: manual cites source + page label; import cites a source", async () => {
    const m = await lib.assertions.enterAsUser(nameClaim({ runId: ctx.manual.id, citation: { sourceId: ctx.src.id, pageLabel: "f. 23v" } }));
    expect(m).toMatchObject({ agent: "manual", citationRegionId: null, citation: { sourceId: ctx.src.id, pageLabel: "f. 23v" } });
    await expect(lib.assertions.enterAsUser(nameClaim({ runId: ctx.manual.id, citation: { sourceId: ctx.src.id } }))).rejects.toMatchObject({ code: "invalid" }); // no page label
    await expect(lib.assertions.enterAsUser(nameClaim({ runId: ctx.manual.id, citation: {} }))).rejects.toMatchObject({ code: "invalid" });
    const i = await lib.assertions.propose(nameClaim({ runId: ctx.imp.id, citation: { sourceId: ctx.src.id } }));
    expect(i).toMatchObject({ agent: "import", status: "proposed" });
    await expect(lib.assertions.propose(nameClaim({ runId: ctx.imp.id, citation: {} }))).rejects.toMatchObject({ code: "invalid" });
    await expect(lib.assertions.propose(nameClaim({ runId: ctx.imp.id, citation: { sourceId: "missing" } }))).rejects.toMatchObject({ code: "not-found" });
  });

  it("I3: a run is required and must exist", async () => {
    await expect(lib.assertions.propose(nameClaim({ runId: undefined }))).rejects.toMatchObject({ code: "invalid" });
    await expect(lib.assertions.propose(nameClaim({ runId: "missing" }))).rejects.toMatchObject({ code: "not-found" });
  });

  it("validates subject, property, values and confidence", async () => {
    const bad = async (patch, code) => { await expect(lib.assertions.propose(nameClaim(patch))).rejects.toMatchObject({ code }); };
    await bad({ subjectId: "missing" }, "not-found");
    await bad({ subjectType: "family" }, "invalid");
    await bad({ property: "favouriteColour" }, "invalid");
    await bad({ property: "" }, "invalid");
    await bad({ originalValue: 5 }, "invalid");
    await bad({ confidence: 2 }, "invalid");
    await bad({ property: "birth.date" }, "invalid"); // dates need a FuzzyDate
    await bad({ property: "birth.date", normalizedValue: "1843" }, "invalid");
    expect((await lib.assertions.propose(nameClaim({ property: "x-custom.note", originalValue: "n" }))).property).toBe("x-custom.note");
  });

  it("date properties carry a FuzzyDate; an age statement can feed a birth range", async () => {
    const birth = fromStatedAge({ value: 32 }, fuzzyDateFromIso("1843-03-12", { calendar: "julian" }), { asWritten: "32 ani" });
    const a = await lib.assertions.propose({ subjectType: "persona", subjectId: ctx.father.id, property: "birth.date", originalValue: "32 ani", normalizedValue: birth, runId: ctx.llm.id, citation: { regionId: ctx.row.id } });
    expect(a.normalizedValue).toMatchObject({ derivedFrom: "computed", calendar: "julian" });
  });

  it("relations link two different personas of the same record", async () => {
    const ok = await lib.assertions.propose({ subjectType: "persona", subjectId: ctx.father.id, property: "parentOf", originalValue: "fiul lui", objectPersonaId: ctx.child.id, runId: ctx.llm.id, citation: { regionId: ctx.row.id } });
    expect(ok.objectPersonaId).toBe(ctx.child.id);
    expect((await lib.assertions.listByObject(ctx.child.id)).map((a) => a.id)).toEqual([ok.id]);
    const other = (await lib.records.createRecord({ kind: "burial", regionIds: [ctx.row.id], runId: ctx.llm.id, personas: [{ nameAsWritten: "Altcineva", role: "deceased" }] })).personas[0];
    const rel = (patch) => lib.assertions.propose({ subjectType: "persona", subjectId: ctx.father.id, property: "parentOf", originalValue: "x", objectPersonaId: ctx.child.id, runId: ctx.llm.id, citation: { regionId: ctx.row.id }, ...patch });
    await expect(rel({ objectPersonaId: other.id })).rejects.toMatchObject({ code: "invalid" });   // different record
    await expect(rel({ objectPersonaId: ctx.father.id })).rejects.toMatchObject({ code: "invalid" }); // itself
    await expect(rel({ objectPersonaId: undefined })).rejects.toMatchObject({ code: "invalid" });    // missing object
    await expect(rel({ objectPersonaId: "missing" })).rejects.toMatchObject({ code: "not-found" });
    await expect(rel({ property: "name", objectPersonaId: ctx.child.id })).rejects.toMatchObject({ code: "invalid" }); // value property with object
    await expect(rel({ subjectType: "record", subjectId: ctx.record.id })).rejects.toMatchObject({ code: "invalid" }); // relation subject must be a persona
  });
});

describe("Assertion: I6 only a user action confirms or rejects", () => {
  it("propose always yields a proposal, even if a status is smuggled in", async () => {
    const a = await lib.assertions.propose({ ...nameClaim(), status: "confirmed", decidedBy: "bot" });
    expect(a.status).toBe("proposed");
    expect(a.decidedBy).toBeNull();
    expect(Object.keys(lib.assertions).filter((k) => /confirm|reject|enter/i.test(k)).sort()).toEqual(["confirmAssertion", "enterAsUser", "rejectAssertion"]);
  });
  it("confirm and reject record who decided and when, change nothing else, and only once", async () => {
    const a = await lib.assertions.propose(nameClaim());
    const c = await lib.assertions.confirmAssertion(a.id, { decidedBy: "researcher" });
    expect(c).toMatchObject({ status: "confirmed", decidedBy: "researcher" });
    expect(c.decidedAt).toBeTruthy();
    const { status, decidedBy, decidedAt, ...contentAfter } = c; const { status: s0, decidedBy: d0, decidedAt: t0, ...contentBefore } = a;
    expect(contentAfter).toEqual(contentBefore); // content fields untouched
    await expect(lib.assertions.confirmAssertion(a.id, { decidedBy: "x" })).rejects.toMatchObject({ code: "conflict" });
    await expect(lib.assertions.rejectAssertion(a.id, { decidedBy: "x" })).rejects.toMatchObject({ code: "conflict" });

    const b = await lib.assertions.propose(nameClaim({ originalValue: "Stefan Haritonn" }));
    const r = await lib.assertions.rejectAssertion(b.id, { decidedBy: "researcher" });
    expect(r.status).toBe("rejected");
    expect((await lib.assertions.get(b.id)).originalValue).toBe("Stefan Haritonn"); // rejected stays
    expect((await lib.assertions.listByStatus("rejected")).map((x) => x.id)).toEqual([b.id]);
  });
  it("a decision needs a decider and an existing assertion", async () => {
    const a = await lib.assertions.propose(nameClaim());
    await expect(lib.assertions.confirmAssertion(a.id)).rejects.toMatchObject({ code: "invalid" });
    await expect(lib.assertions.confirmAssertion(a.id, { decidedBy: " " })).rejects.toMatchObject({ code: "invalid" });
    await expect(lib.assertions.confirmAssertion("missing", { decidedBy: "u" })).rejects.toMatchObject({ code: "not-found" });
    expect((await lib.assertions.get(a.id)).status).toBe("proposed");
  });
  it("enterAsUser stores a confirmed manual claim and requires a manual run", async () => {
    const m = await lib.assertions.enterAsUser(nameClaim({ runId: ctx.manual.id }));
    expect(m).toMatchObject({ status: "confirmed", agent: "manual", decidedBy: "user" });
    await expect(lib.assertions.enterAsUser(nameClaim({ runId: ctx.llm.id }))).rejects.toMatchObject({ code: "invariant" });
    expect(await storage.dbCount("evAssertions")).toBe(1); // the refused call stored nothing
  });
  it("a rejected extraction can be found by region and property so it is not proposed again", async () => {
    const a = await lib.assertions.propose(nameClaim({ property: "occupation", originalValue: "preot" }));
    await lib.assertions.rejectAssertion(a.id, { decidedBy: "u" });
    const known = await lib.assertions.findByRegionProperty(ctx.row.id, "occupation");
    expect(known.map((x) => [x.status, x.originalValue])).toEqual([["rejected", "preot"]]);
    expect(await lib.assertions.findByRegionProperty(ctx.row.id, "name")).toEqual([]);
  });
});

describe("Assertion: I1 append-only, corrections supersede", () => {
  it("no update or delete operations; content cannot be overwritten through the store", async () => {
    expect(Object.keys(lib.assertions).filter((k) => /^(update|delete|remove|set|put|edit|replace|save)/i.test(k))).toEqual([]);
    const a = await lib.assertions.propose(nameClaim());
    await expect(storage.dbAdd("evAssertions", { ...a, originalValue: "tampered" })).rejects.toBeTruthy();
    expect((await lib.assertions.get(a.id)).originalValue).toBe("Ştefan Hariton");
  });
  it("a correction is a new assertion superseding the old; both stay, only the new is current", async () => {
    const wrong = await lib.assertions.propose(nameClaim({ originalValue: "Stefan Haritan" }));
    const fixed = await lib.assertions.enterAsUser(nameClaim({ originalValue: "Ştefan Hariton", runId: ctx.manual.id, supersedesId: wrong.id }));
    expect((await lib.assertions.get(wrong.id)).originalValue).toBe("Stefan Haritan");
    expect((await lib.assertions.listBySubject(ctx.child.id))).toHaveLength(2);
    expect((await lib.assertions.listCurrentBySubject(ctx.child.id)).map((a) => a.id)).toEqual([fixed.id]);
    expect((await lib.assertions.history(fixed.id)).map((a) => a.id)).toEqual([wrong.id, fixed.id]);
  });
  it("supersession must be same subject and property, target must exist, and happens once", async () => {
    const a = await lib.assertions.propose(nameClaim());
    await expect(lib.assertions.propose(nameClaim({ supersedesId: "missing" }))).rejects.toMatchObject({ code: "not-found" });
    await expect(lib.assertions.propose(nameClaim({ property: "occupation", originalValue: "x", supersedesId: a.id }))).rejects.toMatchObject({ code: "invalid" });
    await expect(lib.assertions.propose(nameClaim({ subjectId: ctx.father.id, supersedesId: a.id }))).rejects.toMatchObject({ code: "invalid" });
    await lib.assertions.propose(nameClaim({ originalValue: "v2", supersedesId: a.id }));
    await expect(lib.assertions.propose(nameClaim({ originalValue: "v3", supersedesId: a.id }))).rejects.toMatchObject({ code: "conflict" });
  });

  it("I6: a confirmed assertion can only be superseded by a user action, not by an automated proposal", async () => {
    const confirmed = await lib.assertions.enterAsUser(nameClaim({ runId: ctx.manual.id }));
    await expect(lib.assertions.propose(nameClaim({ originalValue: "Alt nume", supersedesId: confirmed.id }))).rejects.toMatchObject({ code: "invariant" });
    const byUser = await lib.assertions.enterAsUser(nameClaim({ originalValue: "Ştefan Hariton jr.", runId: ctx.manual.id, supersedesId: confirmed.id }));
    expect(byUser.supersedesId).toBe(confirmed.id);
    // proposals may supersede proposals (a better re-run)
    const p1 = await lib.assertions.propose(nameClaim({ property: "occupation", originalValue: "negustor" }));
    const p2 = await lib.assertions.propose(nameClaim({ property: "occupation", originalValue: "negustor (corectat)", supersedesId: p1.id }));
    expect(p2.supersedesId).toBe(p1.id);
  });

  it("age assertions carry a structured value", async () => {
    const age = (normalizedValue) => lib.assertions.propose({ subjectType: "persona", subjectId: ctx.father.id, property: "age", originalValue: "32 ani", normalizedValue, runId: ctx.llm.id, citation: { regionId: ctx.row.id } });
    expect((await age({ value: 32 })).normalizedValue).toEqual({ value: 32, unit: "years", slack: 0 });
    await expect(age(undefined)).rejects.toMatchObject({ code: "invalid" });
    await expect(age("32")).rejects.toMatchObject({ code: "invalid" });
    await expect(age({ value: -1 })).rejects.toMatchObject({ code: "invalid" });
    await expect(age({ value: 2, unit: "weeks" })).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("Assertion decisions are separate append-only events (I1, stricter)", () => {
  it("confirming adds a decision event and leaves the stored assertion byte-for-byte unchanged", async () => {
    const a = await lib.assertions.propose(nameClaim());
    const before = JSON.stringify(await storage.dbGet("evAssertions", a.id));
    const merged = await lib.assertions.confirmAssertion(a.id, { decidedBy: "researcher" });
    expect(JSON.stringify(await storage.dbGet("evAssertions", a.id))).toBe(before); // raw row untouched
    expect((await lib.assertions.getStored(a.id)).status).toBe("proposed");          // stored = as proposed
    expect(merged.status).toBe("confirmed");
    expect((await lib.assertions.get(a.id))).toMatchObject({ status: "confirmed", decidedBy: "researcher" });
    const events = await lib.assertions.decisionsFor(a.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ assertionId: a.id, status: "confirmed", decidedBy: "researcher" });
    expect(events[0].decidedAt).toBeTruthy();
    expect(await storage.dbCount("evAssertionDecisions")).toBe(1);
  });

  it("a second decision is refused by the store and by the database (unique per assertion)", async () => {
    const a = await lib.assertions.propose(nameClaim());
    await lib.assertions.rejectAssertion(a.id, { decidedBy: "u" });
    await expect(lib.assertions.confirmAssertion(a.id, { decidedBy: "u" })).rejects.toMatchObject({ code: "conflict" });
    await expect(storage.dbAdd("evAssertionDecisions", { id: "forged", assertionId: a.id, status: "confirmed", decidedBy: "bot", decidedAt: "2026-01-01" })).rejects.toBeTruthy();
    expect((await lib.assertions.get(a.id)).status).toBe("rejected");
    expect(await storage.dbCount("evAssertionDecisions")).toBe(1);
  });

  it("effective status drives every reader: get, lists, listByStatus, history, current, persona view", async () => {
    const proposed = await lib.assertions.propose(nameClaim({ property: "occupation", originalValue: "a" }));
    const toConfirm = await lib.assertions.propose(nameClaim({ property: "residence", originalValue: "b" }));
    const toReject = await lib.assertions.propose(nameClaim({ property: "houseNumber", originalValue: "c" }));
    const entered = await lib.assertions.enterAsUser(nameClaim({ property: "sex", originalValue: "M", runId: ctx.manual.id }));
    await lib.assertions.confirmAssertion(toConfirm.id, { decidedBy: "u" });
    await lib.assertions.rejectAssertion(toReject.id, { decidedBy: "u" });

    const ids = async (st) => (await lib.assertions.listByStatus(st)).map((a) => a.id).sort();
    expect(await ids("proposed")).toEqual([proposed.id]);
    expect(await ids("confirmed")).toEqual([toConfirm.id, entered.id].sort());
    expect(await ids("rejected")).toEqual([toReject.id]);
    await expect(lib.assertions.listByStatus("pending")).rejects.toMatchObject({ code: "invalid" });
    expect((await lib.assertions.listBySubject(ctx.child.id)).map((a) => [a.property, a.status]).sort())
      .toEqual([["houseNumber", "rejected"], ["occupation", "proposed"], ["residence", "confirmed"], ["sex", "confirmed"]]);
    expect((await lib.assertions.findByRegionProperty(ctx.row.id, "houseNumber"))[0].status).toBe("rejected");
    expect((await lib.assertions.listCurrentBySubject(ctx.child.id)).find((a) => a.id === toConfirm.id).status).toBe("confirmed");

    const view = await lib.personaView.forPersona(ctx.child.id);
    expect(Object.keys(view.facts).sort()).toEqual(["residence", "sex"]);
    expect(view.pending).toEqual([proposed.id]);
  });

  it("a user-entered claim keeps its initial confirmed status and has no decision event", async () => {
    const e = await lib.assertions.enterAsUser(nameClaim({ runId: ctx.manual.id }));
    expect((await lib.assertions.getStored(e.id)).status).toBe("confirmed");
    expect(await lib.assertions.decisionsFor(e.id)).toEqual([]);
    await expect(lib.assertions.rejectAssertion(e.id, { decidedBy: "u" })).rejects.toMatchObject({ code: "conflict" }); // correct it instead
  });

  it("a confirmation (event) still protects the assertion from automated supersession (I6)", async () => {
    const a = await lib.assertions.propose(nameClaim());
    await lib.assertions.confirmAssertion(a.id, { decidedBy: "u" });
    await expect(lib.assertions.propose(nameClaim({ originalValue: "other", supersedesId: a.id }))).rejects.toMatchObject({ code: "invariant" });
    const userFix = await lib.assertions.enterAsUser(nameClaim({ originalValue: "fixed", runId: ctx.manual.id, supersedesId: a.id }));
    expect((await lib.assertions.history(userFix.id)).map((x) => [x.originalValue, x.status])).toEqual([["Ştefan Hariton", "confirmed"], ["fixed", "confirmed"]]);
  });
});
