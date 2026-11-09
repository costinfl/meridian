import { describe, it, expect, beforeEach } from "vitest";
import { freshStorage } from "./evidenceHelpers.js";
import { createEvidenceLibrary } from "../evidence/index.js";
import { createProject, normalizeProject, displayName } from "../models/project.js";
import { addLink, decideLink } from "../conclusions/personaLinks.js";
import { defaultDisplayName, displayChoices, resolveDisplayName, chooseDisplayName, resetDisplayName, personaNameMap } from "../conclusions/displayName.js";
import { exportGedcom } from "../gedcom.js";
import { exportProjectZip, importProjectBundle } from "../share.js";

let lib, storage, ctx;
beforeEach(async () => {
  storage = freshStorage(); lib = createEvidenceLibrary(storage);
  const src = await lib.sources.create({ title: "Arhivă", kind: "other" });
  const copy = (await lib.copies.registerFile(new TextEncoder().encode("x"), { sourceId: src.id, storage: { mode: "blob", blobKey: "k" } })).copy;
  const { wholePageRegion } = await lib.pages.addPage({ copyId: copy.id, pageIndex: 0, width: 1, height: 1 });
  const run = await lib.runs.startRun({ processor: "manual" });
  const mk = async (name) => (await lib.records.createRecord({ kind: "other", regionIds: [wholePageRegion.id], runId: run.id, personas: [{ nameAsWritten: name, role: "subject" }] })).personas[0];
  // one man, found under different names in different archives
  const hu = await mk("Szvet"), ro = await mk("Sfătu");
  let project = normalizeProject(createProject("Veterans", { people: [{ id: "p1", name: "Sfătu", sex: "M", birth: { year: 1895 }, events: [], periods: [], groups: [] }, { id: "p2", name: "Other", sex: "F" }] }));
  ctx = { hu, ro, project, run, names: new Map([[hu.id, "Szvet"], [ro.id, "Sfătu"]]) };
});
const link = (project, personId, persona, who = "researcher") => { const a = addLink(project, { personId, personaId: persona.id }); return decideLink(a.project, a.link.id, "accepted", { decidedBy: who }).project; };

describe("display names (P4.T7)", () => {
  it("default = the name of the FIRST persona accepted for the person, whatever order the links were proposed in", () => {
    const proposedRoFirst = addLink(ctx.project, { personId: "p1", personaId: ctx.ro.id });
    const both = addLink(proposedRoFirst.project, { personId: "p1", personaId: ctx.hu.id });
    // the Hungarian record is identified first, the Romanian one afterwards
    const p1 = decideLink(both.project, both.link.id, "accepted", { decidedBy: "u" }).project;
    const p2 = decideLink(p1, proposedRoFirst.link.id, "accepted", { decidedBy: "u" }).project;
    expect(defaultDisplayName(p2, "p1", ctx.names)).toBe("Szvet");
    expect(displayChoices(p2, "p1", ctx.names).map((c) => [c.name, c.isDefault])).toEqual([["Szvet", true], ["Sfătu", false]]);
  });

  it("without any accepted persona the person's own name is shown; candidates never count", () => {
    expect(defaultDisplayName(ctx.project, "p1", ctx.names)).toBe("Sfătu");
    const cand = addLink(ctx.project, { personId: "p1", personaId: ctx.hu.id }).project;
    expect(defaultDisplayName(cand, "p1", ctx.names)).toBe("Sfătu");
    expect(displayChoices(cand, "p1", ctx.names)).toEqual([]);
  });

  it('the researcher can choose "Display person with this name instead"; nothing else changes', () => {
    let project = link(link(ctx.project, "p1", ctx.hu), "p1", ctx.ro);
    const before = JSON.stringify(project);
    const chosen = chooseDisplayName(project, "p1", ctx.ro.id, ctx.names);
    expect(defaultDisplayName(chosen, "p1", ctx.names)).toBe("Szvet");          // the default is still the first identified
    expect(resolveDisplayName(chosen, "p1", ctx.names)).toBe("Sfătu");
    expect(displayName(chosen.people[0])).toBe("Sfătu");
    expect(displayChoices(chosen, "p1", ctx.names).find((c) => c.isChosen).name).toBe("Sfătu");
    // not merged, not renamed, not re-linked
    expect(chosen.people[0].name).toBe("Sfătu");
    expect(chosen.personaLinks).toEqual(project.personaLinks);
    expect(chosen.families).toEqual(project.families);
    expect(JSON.stringify(project)).toBe(before);                                  // input not mutated
    expect(chosen.people[1]).toBe(project.people[1]);                              // other people untouched
    // choose the other one, then go back to the default
    const other = chooseDisplayName(chosen, "p1", ctx.hu.id, ctx.names);
    expect(displayName(other.people[0])).toBe("Szvet");
    const reset = resetDisplayName(other, "p1");
    expect(reset.people[0].displayNameChoice).toBeNull();
    expect(displayName(reset.people[0])).toBe("Sfătu");                            // person.name; resolveDisplayName gives the first identified
    expect(resolveDisplayName(reset, "p1", ctx.names)).toBe("Szvet");
    expect(resetDisplayName(reset, "p1")).toBe(reset);
  });

  it("only a persona accepted as this person with a name can be chosen", () => {
    const project = link(ctx.project, "p1", ctx.hu);
    expect(() => chooseDisplayName(project, "p1", ctx.ro.id, ctx.names)).toThrow(/not accepted/);
    expect(() => chooseDisplayName(ctx.project, "p1", ctx.hu.id, ctx.names)).toThrow(/not accepted/);
    expect(() => chooseDisplayName(project, "nobody", ctx.hu.id, ctx.names)).toThrow(/Unknown person/);
    expect(() => chooseDisplayName(project, "p1", ctx.hu.id, new Map())).toThrow(/no name/);
  });

  it("rejecting the link a choice rests on clears the choice", () => {
    const project = link(link(ctx.project, "p1", ctx.hu), "p1", ctx.ro);
    const chosen = chooseDisplayName(project, "p1", ctx.ro.id, ctx.names);
    const roLink = chosen.personaLinks.find((l) => l.personaId === ctx.ro.id && l.status === "accepted");
    const after = decideLink(chosen, roLink.id, "rejected", { decidedBy: "researcher" }).project;
    expect(after.people[0].displayNameChoice).toBeNull();
    expect(resolveDisplayName(after, "p1", ctx.names)).toBe("Szvet");
    // a choice on a different, still accepted persona survives a rejection elsewhere
    const keep = chooseDisplayName(project, "p1", ctx.hu.id, ctx.names);
    const huLink = keep.personaLinks.find((l) => l.personaId === ctx.ro.id && l.status === "accepted");
    expect(decideLink(keep, huLink.id, "rejected", { decidedBy: "r" }).project.people[0].displayNameChoice?.personaId).toBe(ctx.hu.id);
  });

  it("the choice persists: reload (normalize) keeps it and the bundle round-trips it; GEDCOM export is unchanged", async () => {
    const project = chooseDisplayName(link(link(ctx.project, "p1", ctx.hu), "p1", ctx.ro), "p1", ctx.hu.id, ctx.names);
    expect(normalizeProject(project).people[0].displayNameChoice).toMatchObject({ personaId: ctx.hu.id, name: "Szvet" });
    expect(exportGedcom(project.people, { sources: [] })).toBe(exportGedcom(ctx.project.people, { sources: [] })); // canonical name is what GEDCOM carries
    const blobs = new Map();
    const store = { saveBlob: async (k, b) => blobs.set(k, b), loadBlob: async (k) => blobs.get(k) ?? null };
    const { project: imported } = await importProjectBundle(await exportProjectZip(project, store), store);
    expect(imported.people[0].displayNameChoice).toMatchObject({ personaId: ctx.hu.id, name: "Szvet" });
    expect(displayName(imported.people[0])).toBe("Szvet");
    expect(imported.people[0].name).toBe("Sfătu");
  });

  it("personaNameMap reads names from the library: the confirmed name fact if any, else the name as written", async () => {
    const project = link(link(ctx.project, "p1", ctx.hu), "p1", ctx.ro);
    expect([...(await personaNameMap(lib, project, "p1"))]).toEqual([[ctx.hu.id, "Szvet"], [ctx.ro.id, "Sfătu"]]);
    const llm = await lib.runs.startRun({ processor: "import" });
    const b = await lib.assertions.propose({ subjectType: "persona", subjectId: ctx.hu.id, property: "name", originalValue: "Szvet Gyula", runId: llm.id, citation: { sourceId: (await lib.sources.list())[0].id } });
    await lib.assertions.confirmAssertion(b.id, { decidedBy: "u" });
    expect((await personaNameMap(lib, project, "p1")).get(ctx.hu.id)).toBe("Szvet Gyula");
  });

  it("the timeline shows the chosen name where a person's name appears", () => {
    expect(displayName({ name: "A" })).toBe("A");
    expect(displayName({ name: "A", displayNameChoice: { personaId: "x", name: "B" } })).toBe("B");
    expect(displayName({ name: "A", displayNameChoice: null })).toBe("A");
    expect(displayName(undefined)).toBe("");
  });
});
