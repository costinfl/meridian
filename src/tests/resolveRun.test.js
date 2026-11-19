import { describe, it, expect } from "vitest";
import { resolveFixture } from "./resolveHelpers.js";
import { findMatches } from "../resolve/run.js";
import { scorePair, DEFAULT_WEIGHTS } from "../resolve/score.js";
import { runMatching, matchInputs } from "../workers/resolveClient.js";
import { applyMatches, MATCH_METHOD, openGroups, pairKey } from "../conclusions/matching.js";
import { currentLinks, decideLink, addLink } from "../conclusions/personaLinks.js";
import { createProject } from "../models/project.js";
import { fuzzyDate } from "../evidence/index.js";

const VARIANTS = [{ canonical: "Ion", variant: "Iohannes" }, { canonical: "Ion", variant: "Ioan" }];
async function setup() {
  const fx = await resolveFixture();
  for (const v of VARIANTS) await fx.library.nameVariants.add(v);
  const project = { ...createProject("T"), people: fx.people, families: fx.families };
  const key = Object.fromEntries(Object.entries(fx.personas).map(([k, p]) => [p.id, k]));
  return { fx, project, key };
}
const pairsOf = (links, key) => links.filter((l) => l.method === MATCH_METHOD).map((l) => `${key[l.personaId]}>${l.personId}:${l.status}`).sort();

describe("Scoring and matching runs (P9.T3)", () => {
  it("score: weighted mean of known signals, less when little is known, pulled down by a different name, 0 on veto", () => {
    expect(scorePair({ signals: { given: 1, surname: 1, date: 1, sex: 1, relatives: 1, place: null, fan: null } })).toBe(1);
    const namesOnly = scorePair({ signals: { given: 1, surname: 1 } });
    expect(namesOnly).toBeLessThan(0.85);
    expect(scorePair({ signals: { given: 0.5, surname: 1, date: 1, sex: 1 } })).toBeLessThan(0.5);
    expect(scorePair({ signals: { given: 1, surname: 1, date: 1 }, veto: "different sex" })).toBe(0);
    expect(scorePair({ signals: {} })).toBe(0);
    expect(Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  it("a run proposes the known answers as CANDIDATE links only (I6), records the run, groups the unknown godmother", async () => {
    const { fx, project, key } = await setup();
    const { run, result, apply } = await runMatching({ library: fx.library, project });
    const r = apply(project);
    const links = currentLinks(r.project);
    expect(links.every((l) => l.status === "candidate" && l.method === MATCH_METHOD && l.decidedBy === null)).toBe(true);
    const expected = Object.entries(fx.truth).filter(([, t]) => t && !t.startsWith("group:")).map(([k, t]) => `${k}>${t}:candidate`).sort();
    expect(pairsOf(links, key)).toEqual(expected);                                      // precision and recall 1 on the fixture
    expect(links[0].signals).toMatchObject({ runId: run.id, usesProposed: false });
    expect((await fx.library.runs.getRun(run.id))).toMatchObject({ processor: "entity-resolution", status: "succeeded" });
    expect(openGroups(r.project).map((g) => g.personaIds.map((id) => key[id]).sort())).toEqual([["b1850.godparent", "m1875.witness"]]);
    expect(r.project.settings.matching.lastRun.counts).toMatchObject({ proposed: 11, added: 11, groups: 1 });
    expect(result.scope).toBe("all");
  });

  it("rejected pairs are never proposed again; decided or waiting pairs are skipped; accepted personas leave the pool", async () => {
    const { fx, project, key } = await setup();
    let p = (await runMatching({ library: fx.library, project })).apply(project).project;
    const groom = currentLinks(p).find((l) => key[l.personaId] === "m1875.groom");
    const child = currentLinks(p).find((l) => key[l.personaId] === "b1850.child");
    p = decideLink(p, groom.id, "rejected", { decidedBy: "me" }).project;
    p = decideLink(p, child.id, "accepted", { decidedBy: "me" }).project;
    const again = await runMatching({ library: fx.library, project: p, full: true });
    const proposed = again.result.proposals.map((x) => key[x.personaId]);
    expect(proposed).not.toContain("m1875.groom");                                     // rejected: never again
    expect(proposed).not.toContain("b1850.child");                                     // accepted: out of the pool
    expect(again.result.counts.skippedRejected).toBe(1);
    expect(again.result.counts.skippedLinked).toBeGreaterThan(0);                      // the other candidates are already waiting
    const after = again.apply(p).project;
    expect(currentLinks(after).find((l) => l.id === groom.id)).toBeUndefined();        // superseded by the rejection, still rejected
    expect(currentLinks(after).filter((l) => key[l.personaId] === "m1875.groom").map((l) => l.status)).toEqual(["rejected"]);
    // even a proposal computed before the rejection is not applied over it
    const stale = applyMatches(after, { ...again.result, proposals: [{ personaId: groom.personaId, personId: "t3", score: 0.99, signals: {}, detail: {} }], groups: [] }, { id: "run-x" });
    expect(stale.added).toBe(0);
  });

  it("an incremental run sees only new records and changed persons, and equals a full run on them", async () => {
    const { fx, project, key } = await setup();
    let p = (await runMatching({ library: fx.library, project })).apply(project).project;
    // a new record (a second baptism of the couple) and a changed person
    const pg = await fx.library.pages.addPage({ copyId: fx.copy.id, pageIndex: 50, label: "50", width: 10, height: 10 });
    const rec = await fx.library.records.createRecord({ kind: "baptism", regionIds: [pg.wholePageRegion.id], runId: fx.run.id, event: fuzzyDate({ year: 1880, month: 6, day: 1, calendar: "julian" }),
      personas: [{ nameAsWritten: "Gheorghe", role: "child" }, { nameAsWritten: "Ion Hariton", role: "father" }, { nameAsWritten: "Elena", role: "mother" }] });
    const nothing = await runMatching({ library: fx.library, project: p });
    expect(nothing.result.scope).toBe("changed");
    const newIds = new Set(rec.personas.map((x) => x.id));
    expect(nothing.result.proposals.every((x) => newIds.has(x.personaId))).toBe(true);
    const full = await runMatching({ library: fx.library, project: p, full: true });
    const onNew = (res) => res.proposals.filter((x) => newIds.has(x.personaId)).map((x) => `${x.personaId}>${x.personId}:${x.score}`).sort();
    expect(onNew(nothing.result)).toEqual(onNew(full.result));
    expect(onNew(nothing.result).length).toBe(3);
    p = nothing.apply(p).project;
    // nothing new: an incremental run compares nothing
    const idle = await runMatching({ library: fx.library, project: p });
    expect(idle.result.counts.rawPairs).toBe(0);
    // a person edited (a new birth year) is compared again against everyone
    p = { ...p, people: p.people.map((x) => (x.id === "t6" ? { ...x, birth: { year: 1852 } } : x)) };
    const edited = await runMatching({ library: fx.library, project: p });
    expect(edited.result.counts.rawPairs).toBeGreaterThan(0);
    expect(matchInputs(p).previous).not.toBeNull();
    expect(key).toBeTruthy();
  });

  it("dismissed groups are not proposed again; a group shrinks when one of its people is linked", async () => {
    const { fx, project, key } = await setup();
    let p = (await runMatching({ library: fx.library, project })).apply(project).project;
    const g = openGroups(p)[0];
    p = { ...p, matchDismissed: [pairKey(g.personaIds[0], g.personaIds[1])], matchGroups: p.matchGroups.map((x) => ({ ...x, status: "dismissed" })) };
    const again = await runMatching({ library: fx.library, project: p, full: true });
    expect(again.result.groups).toEqual([]);
    // without the dismissal, but with one of them linked as a candidate to a tree person: no group of one
    let q = (await runMatching({ library: fx.library, project })).apply(project).project;
    q = addLink(q, { personId: "t6", personaId: g.personaIds[0], method: "manual" }).project;
    const r = await runMatching({ library: fx.library, project: q, full: true });
    expect(r.result.groups).toEqual([]);
    expect(key).toBeTruthy();
  });

  it("findMatches is pure and repeatable", async () => {
    const { fx } = await setup();
    const snapshot = await fx.library.searchIndex.snapshot();
    const a = findMatches({ snapshot, people: fx.people, families: fx.families, links: [] });
    const b = findMatches({ snapshot, people: fx.people, families: fx.families, links: [] });
    expect(a.proposals).toEqual(b.proposals);
    expect(a.groups).toEqual(b.groups);
  });
});
