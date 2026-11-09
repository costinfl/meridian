import { describe, it, expect, beforeEach } from "vitest";
import { freshStorage } from "./evidenceHelpers.js";
import { createEvidenceLibrary } from "../evidence/index.js";
import { createProject, createSource, normalizeProject } from "../models/project.js";
import { SAMPLE_PEOPLE } from "../sampleData.js";
import { exportGedcom } from "../gedcom.js";
import {
  dryRunLegacyConversion, formatDryRun, convertLegacyFacts, confirmLegacyVerified, countLegacyVerifiedPending, setFactVerified,
  FACT_KINDS, LEGACY_METHOD,
} from "../conclusions/legacyFacts.js";
import { currentLinks, linksOfPerson } from "../conclusions/personaLinks.js";

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
    expect(r.wouldCreate.assertions).toEqual({ name: 8, sex: 8, facts: countFacts(project), total: 16 + countFacts(project) });
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

  it("every fact gets one proposed import assertion as its preferred assertion, cited to its source or the legacy source", async () => {
    const project = sampleProject();
    const { project: out } = await convertLegacyFacts({ ...deps, project });
    const hariton = out.people[0];
    const legacy = await library.sources.get(out.legacyEvidence.librarySourceId);
    expect(legacy.title).toBe("Legacy Meridian data");
    const asr = (id) => library.assertions.get(id);

    const birth = await asr(hariton.birth.preferredAssertionId);
    expect(birth).toMatchObject({ status: "proposed", agent: "import", property: "x-legacy.birth", originalValue: "Born 1850, Săhăteni", citation: { sourceId: legacy.id } });
    expect(birth.normalizedValue).toMatchObject({ year: 1850, place: "Săhăteni" });
    expect(hariton.birth.assertionIds).toEqual([birth.id]);

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

  it("persons become import personas linked by an accepted legacy link; names and sex are asserted too", async () => {
    const { project: out } = await convertLegacyFacts({ ...deps, project: sampleProject() });
    expect(currentLinks(out)).toHaveLength(8);
    const link = linksOfPerson(out, "i1")[0];
    expect(link).toMatchObject({ status: "accepted", method: LEGACY_METHOD, decidedBy: LEGACY_METHOD });
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

describe("one-time confirmation of verified facts, and keeping `verified` consistent (P4.T4, P4.T5)", () => {
  it("counts the pending verified facts, confirms them with decidedBy 'legacy-verified', and leaves the rest proposed", async () => {
    const { project } = await convertLegacyFacts({ ...deps, project: sampleProject() });
    expect(await countLegacyVerifiedPending({ library, project })).toBe(5);
    const r = await confirmLegacyVerified({ library, project });
    expect(r).toEqual({ confirmed: 5, alreadyConfirmed: 0, skipped: 0 });
    expect(await countLegacyVerifiedPending({ library, project })).toBe(0);
    const confirmed = await library.assertions.listByStatus("confirmed");
    expect(confirmed).toHaveLength(5);
    expect(new Set(confirmed.map((a) => a.decidedBy))).toEqual(new Set(["legacy-verified"]));
    expect((await library.assertions.listByStatus("proposed")).length).toBe(await storage.dbCount("evAssertions") - 5);
    // every verified fact now has a confirmed preferred assertion; every unverified one does not
    for (const p of project.people) for (const f of [p.birth, p.death, ...p.events, ...p.periods, ...p.groups]) {
      if (!f?.preferredAssertionId) continue;
      expect((await library.assertions.get(f.preferredAssertionId)).status === "confirmed").toBe(!!f.verified);
    }
    expect(await confirmLegacyVerified({ library, project })).toEqual({ confirmed: 0, alreadyConfirmed: 5, skipped: 0 });
  });

  it("toggling verified goes through assertion decisions: verify confirms, un-verify adds a new proposed preferred assertion", async () => {
    const { project } = await convertLegacyFacts({ ...deps, project: sampleProject() });
    const unverified = project.people[1].birth;               // Dumitru S. Hariton, not verified
    expect(unverified.verified).toBeFalsy();
    const on = await setFactVerified({ library, fact: unverified, verified: true });
    expect(on.preferredAssertionId).toBe(unverified.preferredAssertionId);   // same assertion, now confirmed by a user decision
    const confirmed = await library.assertions.get(on.preferredAssertionId);
    expect(confirmed).toMatchObject({ status: "confirmed", decidedBy: "user" });

    const afterOn = { ...unverified, ...on, verified: true };
    const off = await setFactVerified({ library, fact: afterOn, verified: false });
    expect(off.preferredAssertionId).not.toBe(on.preferredAssertionId);
    expect(off.assertionIds).toEqual([on.preferredAssertionId, off.preferredAssertionId]);
    expect((await library.assertions.get(off.preferredAssertionId)).status).toBe("proposed");
    expect((await library.assertions.get(on.preferredAssertionId)).status).toBe("confirmed");   // history stays
    expect((await library.assertions.getStored(off.preferredAssertionId))).toMatchObject({ originalValue: confirmed.originalValue, citation: confirmed.citation });

    const again = await setFactVerified({ library, fact: { ...afterOn, ...off, verified: false }, verified: false });
    expect(again.preferredAssertionId).toBe(off.preferredAssertionId);                       // already not verified: no new assertion
    const back = await setFactVerified({ library, fact: { ...afterOn, ...off, verified: false }, verified: true });
    expect(back.preferredAssertionId).toBe(off.preferredAssertionId);
    expect((await library.assertions.get(back.preferredAssertionId)).status).toBe("confirmed");
  });

  it("verifying a fact whose proposal was rejected re-proposes it first; unconverted facts are left to the plain flag", async () => {
    const { project } = await convertLegacyFacts({ ...deps, project: sampleProject() });
    const fact = project.people[1].death;
    await library.assertions.rejectAssertion(fact.preferredAssertionId, { decidedBy: "u" });
    const r = await setFactVerified({ library, fact, verified: true });
    expect(r.preferredAssertionId).not.toBe(fact.preferredAssertionId);
    expect((await library.assertions.get(r.preferredAssertionId)).status).toBe("confirmed");
    expect(await setFactVerified({ library, fact: { year: 1900, verified: false, assertionIds: [], preferredAssertionId: null }, verified: true })).toBeNull();
  });
});
