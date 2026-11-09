import { describe, it, expect, beforeEach } from "vitest";
import { freshStorage } from "./evidenceHelpers.js";
import { createEvidenceLibrary } from "../evidence/index.js";
import { createProject, createSource, normalizeProject } from "../models/project.js";
import { SAMPLE_PEOPLE } from "../sampleData.js";
import { exportGedcom } from "../gedcom.js";
import {
  dryRunLegacyConversion, formatDryRun, convertLegacyFacts, confirmLegacyVerified, countLegacyVerifiedPending, setFactVerified,
  applyFactEdit, activeAssertionsOf, FACT_KINDS, LEGACY_METHOD,
} from "../conclusions/legacyFacts.js";
import { currentLinks, linksOfPerson, decideLink } from "../conclusions/personaLinks.js";

const clone = (x) => JSON.parse(JSON.stringify(x));
let storage, library, blobs, deps;
beforeEach(() => {
  storage = freshStorage(); library = createEvidenceLibrary(storage); blobs = new Map();
  deps = { library, loadBlob: async (k) => blobs.get(k) ?? null, saveBlob: async (k, b) => { blobs.set(k, b); } };
});

/** The seeded sample plus two sources (one with a file) cited by a few facts, as a real project would have. */
function sampleProject() {
  const register = createSource({ title: "Registrul de botezuri", type: "document", repository: "ANPh", date: "1850", blobKey: "blob_1_reg.pdf", fileName: "reg.pdf" });
  const book = createSource({ title: "Monografia Ploieștiului", type: "text", text: "..." });
  blobs.set("blob_1_reg.pdf", new Blob(["register scan bytes"], { type: "application/pdf" }));
  const people = clone(SAMPLE_PEOPLE);
  people[0].events[1].sourceId = register.id;   // Elected mayor (verified)
  people[0].periods[1].sourceId = book.id;      // Mayor period (verified)
  people[4].events[0].sourceId = "ghost";       // points at a source that does not exist
  return normalizeProject(createProject("Hariton", { people, sources: [register, book] }));
}
const countFacts = (project) => project.people.reduce((n, p) => n + (p.birth?.year != null || p.birth?.place ? 1 : 0) + (p.death?.year != null || p.death?.place ? 1 : 0) + p.events.length + p.periods.length + p.groups.length, 0);

describe("dry run (P4.T3): pure report, writes nothing", () => {
  it("counts people, facts per type, sources, verified, anomalies and fields with no target", () => {
    const project = sampleProject();
    const before = JSON.stringify(project);
    const r = dryRunLegacyConversion(project);
    expect(JSON.stringify(project)).toBe(before);                                  // read-only
    expect(r.people).toBe(8);
    expect(r.facts.birth).toMatchObject({ total: 8, toConvert: 8, verified: 1, unverified: 7, withSource: 0, withoutSource: 8 });
    expect(r.facts.event).toMatchObject({ total: 14, verified: 2, withSource: 2, withoutSource: 12 });
    expect(r.facts.period).toMatchObject({ total: 7, verified: 1, withSource: 1 });
    expect(r.facts.group).toMatchObject({ total: 2, verified: 0 });
    expect(FACT_KINDS.reduce((n, k) => n + r.facts[k].total, 0)).toBe(countFacts(project));
    expect(r.wouldCreate).toMatchObject({ anchor: 1, records: 8, personas: 8, links: 8, sourcesToLink: 2 });
    // 8 births + 8 deaths, each with a year and a place -> 2 assertions each; events, periods, groups -> 1 each
    expect(r.wouldCreate.assertions).toEqual({ name: 8, sex: 8, facts: countFacts(project) + 16, total: 16 + countFacts(project) + 16 });
    expect(r.verifiedToConfirm).toBe(5);
    expect(r.anomalies.map((a) => a.message).join("|")).toMatch(/ghost/);        // dangling source id
    expect(r.anomalies.some((a) => /verified without a source/.test(a.message))).toBe(true);
    expect(formatDryRun(r)).toContain("Would create: 8 records");
  });
  it("flags odd data without failing: nameless person, event without year, period backwards", () => {
    const p = normalizeProject(createProject("T", { people: [{ id: "a", name: "", events: [{ label: "x" }], periods: [{ start: 1900, end: 1800, label: "y" }], groups: [] }] }));
    const msgs = dryRunLegacyConversion(p).anomalies.map((a) => a.message).join("|");
    expect(msgs).toMatch(/no name/); expect(msgs).toMatch(/without a year/); expect(msgs).toMatch(/after end/);
  });
});

describe("conversion (P4.T4): legacy facts become proposed import assertions", () => {
  it("creates exactly what the dry run announced, and leaves the timeline data untouched", async () => {
    const project = sampleProject();
    const plan = dryRunLegacyConversion(project);
    const { project: out, created, warnings } = await convertLegacyFacts({ ...deps, project });
    expect(created).toMatchObject({ anchor: 1, records: plan.wouldCreate.records, personas: plan.wouldCreate.personas, links: plan.wouldCreate.links, assertions: plan.wouldCreate.assertions.total, sourcesLinked: plan.wouldCreate.sourcesToLink });
    expect(await storage.dbCount("evRecords")).toBe(8);
    expect(await storage.dbCount("evPersonas")).toBe(8);
    expect(await storage.dbCount("evAssertions")).toBe(plan.wouldCreate.assertions.total);
    expect(warnings.join(" ")).toMatch(/text-only/);

    // the timeline's own facts are unchanged apart from the evidence fields
    const strip = (f) => { if (!f || typeof f !== "object") return f; const { assertionIds, preferredAssertionId, ...rest } = f; return rest; };
    for (const [a, b] of out.people.map((p, i) => [p, project.people[i]])) {
      expect(strip(a.birth)).toEqual(strip(b.birth)); expect(strip(a.death)).toEqual(strip(b.death));
      expect(a.events.map(strip)).toEqual(b.events.map(strip)); expect(a.periods.map(strip)).toEqual(b.periods.map(strip));
      expect(a.name).toBe(b.name); expect(a.fatherId ?? null).toBe(b.fatherId ?? null);
    }
    expect(out.families).toEqual(project.families);
    expect(exportGedcom(out.people, { sources: out.sources })).toBe(exportGedcom(project.people, { sources: project.sources })); // I8
  });

  it("facts get proposed import assertions (birth/death split into date and place), cited to their source or the legacy source", async () => {
    const project = sampleProject();
    const { project: out } = await convertLegacyFacts({ ...deps, project });
    const hariton = out.people[0];
    const legacy = await library.sources.get(out.legacyEvidence.librarySourceId);
    expect(legacy.title).toBe("Legacy Meridian data");
    const asr = (id) => library.assertions.get(id);

    // a birth is split: a date assertion (primary, year-precision FuzzyDate) and a place assertion
    expect(hariton.birth.assertionIds).toHaveLength(2);
    const birth = await asr(hariton.birth.preferredAssertionId);
    expect(birth).toMatchObject({ status: "proposed", agent: "import", property: "birth.date", originalValue: "1850", citation: { sourceId: legacy.id } });
    expect(birth.normalizedValue).toMatchObject({ asWritten: "1850", earliest: "1850-01-01", latest: "1850-12-31", precision: "year", calendar: "gregorian" });
    const place = await asr(hariton.birth.assertionIds[1]);
    expect(place).toMatchObject({ status: "proposed", property: "birth.place", originalValue: "Săhăteni", normalizedValue: "Săhăteni", citation: { sourceId: legacy.id } });
    const death = await Promise.all(hariton.death.assertionIds.map(asr));
    expect(death.map((x) => [x.property, x.originalValue])).toEqual([["death.date", "1927"], ["death.place", "Ploiești"]]);

    const mayor = hariton.events[1];                                // has the register as its source
    const a = await asr(mayor.preferredAssertionId);
    const regLibId = out.sources[0].librarySourceId;
    expect(regLibId).toBeTruthy();
    expect(a).toMatchObject({ property: "x-legacy.event", originalValue: "Elected mayor of Ploiești", citation: { sourceId: regLibId } });
    expect((await library.copies.listBySource(regLibId))).toHaveLength(1);   // its scan became a DigitalCopy

    const ghost = await asr(out.people[4].events[0].preferredAssertionId);
    expect(ghost.citation.sourceId).toBe(legacy.id);                          // dangling source falls back to the legacy source

    const period = await asr(hariton.periods[1].preferredAssertionId);
    expect(period.normalizedValue).toMatchObject({ start: 1893, end: 1897, label: "Mayor of Ploiești" });
    expect(period.originalValue).toBe("1893-1897 Mayor of Ploiești");
    for (const k of ["birth", "death"]) expect(hariton[k].preferredAssertionId).toBeTruthy();
    // no verified fact was confirmed by the conversion itself (I6)
    expect((await library.assertions.listByStatus("confirmed"))).toEqual([]);
    expect((await library.assertions.listByStatus("proposed")).length).toBe(await storage.dbCount("evAssertions"));
  });

  it("persons become import personas linked by a CANDIDATE legacy link; names and sex are asserted too", async () => {
    const { project: out } = await convertLegacyFacts({ ...deps, project: sampleProject() });
    expect(currentLinks(out)).toHaveLength(8);
    const link = linksOfPerson(out, "i1")[0];
    expect(link).toMatchObject({ status: "candidate", method: LEGACY_METHOD, decidedBy: null });   // nothing accepted by conversion (I6)
    expect(currentLinks(out).every((l) => l.status === "candidate")).toBe(true);
    expect(out.personaLinks).toHaveLength(8);
    const persona = await library.records.getPersona(link.personaId);
    expect(persona).toMatchObject({ nameAsWritten: "Dumitru D. Hariton", role: "subject" });
    const props = (await library.assertions.listBySubject(persona.id)).map((a) => a.property);
    expect(props).toContain("x-legacy.name"); expect(props).toContain("x-legacy.sex");
    const record = await library.records.getRecord(persona.recordId);
    expect(record.regionIds).toEqual([out.legacyEvidence.regionId]);
    // the snapshot of legacy data is a real DigitalCopy in the library
    const copy = await library.copies.get(out.legacyEvidence.copyId);
    expect(copy).toMatchObject({ fileName: "legacy-meridian-data.json", mimeType: "application/json", storage: { mode: "blob" } });
    expect(blobs.has(copy.storage.blobKey)).toBe(true);
    const run = await library.runs.getRun(out.legacyEvidence.runIds[0]);
    expect(run).toMatchObject({ processor: "import", status: "succeeded" });
  });

  it("is idempotent: a second run changes nothing and writes nothing", async () => {
    const first = await convertLegacyFacts({ ...deps, project: sampleProject() });
    const counts = async () => Object.fromEntries(await Promise.all(["evRecords", "evPersonas", "evAssertions", "evRuns", "evSources", "evCopies", "evRepositories"].map(async (s) => [s, await storage.dbCount(s)])));
    const before = await counts();
    const second = await convertLegacyFacts({ ...deps, project: first.project });
    expect(second.project).toBe(first.project);
    expect(second.created).toEqual({ anchor: 0, records: 0, personas: 0, links: 0, assertions: 0, sourcesLinked: 0 });
    expect(await counts()).toEqual(before);
  });

  it("converts only what is new when facts or people are added later, reusing the legacy source", async () => {
    const first = await convertLegacyFacts({ ...deps, project: sampleProject() });
    const added = normalizeProject({ ...first.project,
      people: [...first.project.people.map((p) => (p.id === "i1" ? { ...p, events: [...p.events, { id: "new-ev", year: 1930, label: "Late note", type: "note", verified: false }] } : p)), { id: "n1", name: "Newcomer", sex: "F", birth: { year: 1960, place: "X" }, events: [], periods: [], groups: [] }] });
    const plan = dryRunLegacyConversion(added);
    expect(plan.wouldCreate).toMatchObject({ anchor: 0, records: 1, personas: 1 });
    const second = await convertLegacyFacts({ ...deps, project: added });
    expect(second.created).toMatchObject({ anchor: 0, records: 1, personas: 1, links: 1, assertions: plan.wouldCreate.assertions.total });
    expect(second.project.legacyEvidence.librarySourceId).toBe(first.project.legacyEvidence.librarySourceId);
    expect(second.project.legacyEvidence.runIds).toHaveLength(2);
    expect(second.project.people.find((p) => p.id === "i1").events.at(-1).preferredAssertionId).toBeTruthy();
  });

  it("a failure leaves the project unchanged (nothing is returned to save) and marks the run failed", async () => {
    const project = sampleProject();
    const boom = { ...library, assertions: { ...library.assertions, propose: async () => { throw new Error("disk full"); } } };
    await expect(convertLegacyFacts({ ...deps, library: boom, project })).rejects.toThrow("disk full");
    expect((await library.runs.listRuns())[0]).toMatchObject({ processor: "import", status: "failed" });
    expect(project.people[0].birth.preferredAssertionId).toBeNull();
  });
});

const statuses = async (fact) => (await activeAssertionsOf(library, fact)).map((a) => [a.property, a.status, a.originalValue]);

describe("one-time confirmation of verified facts, and keeping `verified` consistent (P4.T4, P4.T5)", () => {
  it("counts the pending verified facts, confirms all their assertions with decidedBy 'legacy-verified', leaves the rest proposed", async () => {
    const { project } = await convertLegacyFacts({ ...deps, project: sampleProject() });
    expect(await countLegacyVerifiedPending({ library, project })).toBe(5);        // 5 FACTS: a birth, a death, 2 events, a period
    const r = await confirmLegacyVerified({ library, project });
    expect(r).toEqual({ confirmed: 5, alreadyConfirmed: 0, skipped: 0, assertions: 7 }); // birth and death have date + place
    expect(await countLegacyVerifiedPending({ library, project })).toBe(0);
    const confirmed = await library.assertions.listByStatus("confirmed");
    expect(confirmed).toHaveLength(7);
    expect(new Set(confirmed.map((a) => a.decidedBy))).toEqual(new Set(["legacy-verified"]));
    expect((await library.assertions.listByStatus("proposed")).length).toBe(await storage.dbCount("evAssertions") - 7);
    // a fact is verified <=> every one of its active assertions is confirmed
    for (const p of project.people) for (const f of [p.birth, p.death, ...p.events, ...p.periods, ...p.groups]) {
      if (!f?.preferredAssertionId) continue;
      const active = await activeAssertionsOf(library, f);
      expect(active.length).toBeGreaterThan(0);
      expect(active.every((a) => a.status === "confirmed")).toBe(!!f.verified);
      expect(active.some((a) => a.status === "confirmed")).toBe(!!f.verified);
    }
    expect(await confirmLegacyVerified({ library, project })).toEqual({ confirmed: 0, alreadyConfirmed: 5, skipped: 0, assertions: 0 });
  });

  it("toggling verified: verify confirms date and place; un-verify supersedes each with a proposed copy and keeps the history", async () => {
    const { project } = await convertLegacyFacts({ ...deps, project: sampleProject() });
    const birth = project.people[1].birth;                      // Dumitru S. Hariton, 1818 Ploiești, not verified
    const on = await setFactVerified({ library, fact: birth, verified: true });
    expect(on).toEqual({ assertionIds: birth.assertionIds, preferredAssertionId: birth.preferredAssertionId }); // same assertions, now confirmed
    expect(await statuses({ ...birth, ...on })).toEqual([["birth.date", "confirmed", "1818"], ["birth.place", "confirmed", "Ploiești"]]);
    expect((await library.assertions.get(on.preferredAssertionId)).decidedBy).toBe("user");

    const afterOn = { ...birth, ...on, verified: true };
    const off = await setFactVerified({ library, fact: afterOn, verified: false });
    expect(off.assertionIds).toHaveLength(4);                   // 2 confirmed (history) + 2 proposed copies
    expect(off.preferredAssertionId).not.toBe(on.preferredAssertionId);
    const afterOff = { ...afterOn, ...off, verified: false };
    expect(await statuses(afterOff)).toEqual([["birth.date", "proposed", "1818"], ["birth.place", "proposed", "Ploiești"]]);
    const pref = await library.assertions.get(off.preferredAssertionId);
    expect(pref).toMatchObject({ property: "birth.date", supersedesId: on.preferredAssertionId, agent: "import" }); // same reading, nothing new was read
    expect((await library.assertions.get(on.preferredAssertionId)).status).toBe("confirmed");                         // history stays

    const again = await setFactVerified({ library, fact: afterOff, verified: false });
    expect(again).toEqual(off);                                 // already not verified: nothing new
    const back = await setFactVerified({ library, fact: afterOff, verified: true });
    expect(back).toEqual(off);
    expect(await statuses(afterOff)).toEqual([["birth.date", "confirmed", "1818"], ["birth.place", "confirmed", "Ploiești"]]);
  });

  it("verifying a fact whose proposal was rejected re-proposes it first; unconverted facts are left to the plain flag", async () => {
    const { project } = await convertLegacyFacts({ ...deps, project: sampleProject() });
    const fact = project.people[1].death;
    await library.assertions.rejectAssertion(fact.preferredAssertionId, { decidedBy: "u" });
    const r = await setFactVerified({ library, fact, verified: true });
    expect(r.preferredAssertionId).not.toBe(fact.preferredAssertionId);
    expect((await statuses({ ...fact, ...r })).map((x) => x[1])).toEqual(["confirmed", "confirmed"]);
    expect((await library.assertions.get(fact.preferredAssertionId)).status).toBe("rejected");   // the rejection stays on record
    expect(await setFactVerified({ library, fact: { year: 1900, verified: false, assertionIds: [], preferredAssertionId: null }, verified: true })).toBeNull();
  });
});

describe("editing a converted fact creates superseding assertions (Phase 4 review, question b)", () => {
  const converted = async () => (await convertLegacyFacts({ ...deps, project: sampleProject() })).project;

  it("changing a birth year supersedes only the date assertion, entered by the user (agent manual)", async () => {
    const project = await converted();
    const before = project.people[1].birth;                    // 1818, Ploiești, unverified
    const patch = await applyFactEdit({ library, kind: "birth", personId: "i2", before, after: { ...before, year: 1819 } });
    expect(patch.assertionIds).toHaveLength(3);
    const after = { ...before, year: 1819, ...patch };
    expect(await statuses(after)).toEqual([["birth.place", "proposed", "Ploiești"], ["birth.date", "proposed", "1819"]]);
    const date = await library.assertions.get(patch.preferredAssertionId);
    expect(date).toMatchObject({ property: "birth.date", agent: "manual", supersedesId: before.preferredAssertionId, citation: { pageLabel: "timeline" } });
    expect(date.normalizedValue).toMatchObject({ earliest: "1819-01-01", latest: "1819-12-31", precision: "year" });
    expect((await library.assertions.getStored(before.preferredAssertionId)).originalValue).toBe("1818");   // the old reading is kept
    expect((await library.assertions.history(date.id)).map((a) => a.originalValue)).toEqual(["1818", "1819"]);
    expect((await library.runs.getRun(date.runId))).toMatchObject({ processor: "manual", status: "succeeded" });
  });

  it("changing only the place supersedes only the place; an unchanged save creates nothing", async () => {
    const project = await converted();
    const before = project.people[1].birth;
    const same = await applyFactEdit({ library, kind: "birth", personId: "i2", before, after: { ...before } });
    expect(same).toEqual({ assertionIds: before.assertionIds, preferredAssertionId: before.preferredAssertionId });
    const count = await storage.dbCount("evAssertions");
    const patch = await applyFactEdit({ library, kind: "birth", personId: "i2", before, after: { ...before, place: "Câmpina" } });
    expect(await storage.dbCount("evAssertions")).toBe(count + 1);
    expect(patch.preferredAssertionId).toBe(before.preferredAssertionId);                // the date is still the primary
    expect(await statuses({ ...before, ...patch })).toEqual([["birth.date", "proposed", "1818"], ["birth.place", "proposed", "Câmpina"]]);
  });

  it("editing a VERIFIED fact: the new value replaces the confirmed one and is confirmed by the same user action", async () => {
    const project = await converted();
    await confirmLegacyVerified({ library, project });
    const before = project.people[0].birth;                    // 1850 Săhăteni, verified
    const patch = await applyFactEdit({ library, kind: "birth", personId: "i1", before, after: { ...before, year: 1851 } });
    const after = { ...before, year: 1851, ...patch };
    expect(await statuses(after)).toEqual([["birth.place", "confirmed", "Săhăteni"], ["birth.date", "confirmed", "1851"]]);
    expect((await library.assertions.get(patch.preferredAssertionId))).toMatchObject({ decidedBy: "user", agent: "manual" });
    expect((await library.assertions.get(before.preferredAssertionId))).toMatchObject({ status: "confirmed", originalValue: "1850", decidedBy: "legacy-verified" }); // history
  });

  it("an edit that also un-verifies or verifies applies both in one go", async () => {
    const project = await converted();
    await confirmLegacyVerified({ library, project });
    const v = project.people[0].birth;
    const off = await applyFactEdit({ library, kind: "birth", personId: "i1", before: v, after: { ...v, year: 1852, verified: false } });
    expect((await statuses({ ...v, ...off })).map((x) => [x[0], x[1]]).sort()).toEqual([["birth.date", "proposed"], ["birth.place", "proposed"]]);
    const u = project.people[1].death;                        // unverified
    const on = await applyFactEdit({ library, kind: "death", personId: "i2", before: u, after: { ...u, place: "București", verified: true } });
    expect((await statuses({ ...u, ...on })).map((x) => [x[0], x[1], x[2]]).sort()).toEqual([["death.date", "confirmed", "1884"], ["death.place", "confirmed", "București"]]);
  });

  it("events, roles and groups: a changed label, year or note supersedes their single assertion", async () => {
    const project = await converted();
    const ev = project.people[0].events[0];                    // 1875 Marries Elena Băltăceanu
    const patch = await applyFactEdit({ library, kind: "event", personId: "i1", before: ev, after: { ...ev, year: 1876, label: "Marries Elena Băltăceanu (civil)" } });
    const a = await library.assertions.get(patch.preferredAssertionId);
    expect(a).toMatchObject({ property: "x-legacy.event", originalValue: "Marries Elena Băltăceanu (civil)", supersedesId: ev.preferredAssertionId, agent: "manual" });
    expect(a.normalizedValue).toMatchObject({ year: 1876 });
    const per = project.people[0].periods[0];
    const p2 = await applyFactEdit({ library, kind: "period", personId: "i1", before: per, after: { ...per, end: 1922 } });
    expect((await library.assertions.get(p2.preferredAssertionId)).normalizedValue).toMatchObject({ start: 1880, end: 1922 });
    // a change that is not part of the claim (colour) creates nothing
    const n = await storage.dbCount("evAssertions");
    await applyFactEdit({ library, kind: "event", personId: "i1", before: { ...ev, ...patch }, after: { ...ev, ...patch, year: 1876, label: "Marries Elena Băltăceanu (civil)", color: "#000" } });
    expect(await storage.dbCount("evAssertions")).toBe(n);
  });

  it("a place added to a birth that had none gets a new assertion; a removed place keeps its old assertion", async () => {
    const people = [{ id: "a", name: "A", sex: "F", birth: { year: 1900 }, death: {}, events: [], periods: [], groups: [] }];
    const project = (await convertLegacyFacts({ ...deps, project: normalizeProject(createProject("T", { people })) })).project;
    const before = project.people[0].birth;
    expect(before.assertionIds).toHaveLength(1);
    const patch = await applyFactEdit({ library, kind: "birth", personId: "a", before, after: { ...before, place: "Iași" } });
    expect(await statuses({ ...before, ...patch })).toEqual([["birth.date", "proposed", "1900"], ["birth.place", "proposed", "Iași"]]);
    const withPlace = { ...before, place: "Iași", ...patch };
    const cleared = await applyFactEdit({ library, kind: "birth", personId: "a", before: withPlace, after: { ...withPlace, place: "" } });
    expect(cleared.assertionIds).toEqual(patch.assertionIds);                          // evidence is never deleted
    expect(await applyFactEdit({ library, kind: "birth", personId: "a", before: { year: 1900, assertionIds: [], preferredAssertionId: null }, after: { year: 1901 } })).toBeNull();
  });

  it("supersedeAsUser is the only way to replace a confirmed assertion with a proposed one, and needs a target", async () => {
    const project = await converted();
    await confirmLegacyVerified({ library, project });
    const a = await library.assertions.get(project.people[0].birth.preferredAssertionId);
    const input = { subjectType: "persona", subjectId: a.subjectId, property: a.property, originalValue: "1849", normalizedValue: a.normalizedValue, runId: a.runId, citation: a.citation };
    await expect(library.assertions.propose({ ...input, supersedesId: a.id })).rejects.toMatchObject({ code: "invariant" });
    await expect(library.assertions.supersedeAsUser(input)).rejects.toMatchObject({ code: "invalid" });
    expect((await library.assertions.supersedeAsUser({ ...input, supersedesId: a.id })).status).toBe("proposed");
  });

  it("accepting a legacy link is a separate user action per person", async () => {
    const project = await converted();
    const link = linksOfPerson(project, "i1")[0];
    const after = decideLink(project, link.id, "accepted", { decidedBy: "user" }).project;
    expect(linksOfPerson(after, "i1")[0]).toMatchObject({ status: "accepted", decidedBy: "user", supersedesId: link.id });
    expect(currentLinks(after).filter((l) => l.status === "candidate")).toHaveLength(7);
    // converting again reuses the persona whatever the link's status
    const again = await convertLegacyFacts({ ...deps, project: after });
    expect(again.project).toBe(after);
  });
});
