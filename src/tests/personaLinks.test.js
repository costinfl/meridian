import { describe, it, expect } from "vitest";
import { createProject } from "../models/project.js";
import { addLink, decideLink, currentLinks, linksOfPerson, currentLinkFor, isRejectedPair, acceptedLinksInOrder } from "../conclusions/personaLinks.js";
import { addRelationship, addConclusionEvidence, addProofNote } from "../conclusions/conclusions.js";

const base = () => createProject("T", { people: [{ id: "p1", name: "A" }, { id: "p2", name: "B" }] });

describe("PersonaLinks (I6: nothing accepted without a user action)", () => {
  it("addLink creates a candidate no matter what status is passed", () => {
    const { project, link } = addLink(base(), { personId: "p1", personaId: "x1", method: "entity-resolution", score: 0.82, signals: { name: 0.9 }, status: "accepted", decidedBy: "bot" });
    expect(link).toMatchObject({ status: "candidate", decidedBy: null, decidedAt: null, supersedesId: null, score: 0.82, method: "entity-resolution" });
    expect(project.personaLinks).toEqual([link]);
    expect(linksOfPerson(project, "p1")).toEqual([link]);
  });
  it("adding the same pair again returns the existing link and the same project", () => {
    const a = addLink(base(), { personId: "p1", personaId: "x1" });
    const b = addLink(a.project, { personId: "p1", personaId: "x1" });
    expect(b.project).toBe(a.project);
    expect(b.link).toBe(a.link);
    expect(() => addLink(base(), { personId: "p1" })).toThrow();
  });
  it("decideLink adds a superseding link; the original and its history stay", () => {
    const a = addLink(base(), { personId: "p1", personaId: "x1" });
    const d = decideLink(a.project, a.link.id, "accepted", { decidedBy: "researcher", rationale: "same parents and parish" });
    expect(d.link).toMatchObject({ status: "accepted", decidedBy: "researcher", supersedesId: a.link.id, rationale: "same parents and parish" });
    expect(d.link.decidedAt).toBeTruthy();
    expect(d.project.personaLinks).toHaveLength(2);
    expect(d.project.personaLinks[0]).toEqual(a.link);             // untouched
    expect(currentLinks(d.project)).toEqual([d.link]);
    expect(currentLinkFor(d.project, "p1", "x1").status).toBe("accepted");
    // changing one's mind later is another superseding link
    const r = decideLink(d.project, d.link.id, "rejected", { decidedBy: "researcher" });
    expect(currentLinks(r.project)).toEqual([r.link]);
    expect(r.project.personaLinks).toHaveLength(3);
  });
  it("needs a decider, a valid status and a current link; deciding the same status again is a no-op", () => {
    const a = addLink(base(), { personId: "p1", personaId: "x1" });
    expect(() => decideLink(a.project, a.link.id, "accepted")).toThrow(/decidedBy/);
    expect(() => decideLink(a.project, a.link.id, "accepted", { decidedBy: " " })).toThrow(/decidedBy/);
    expect(() => decideLink(a.project, a.link.id, "candidate", { decidedBy: "u" })).toThrow(/status/);
    expect(() => decideLink(a.project, "nope", "accepted", { decidedBy: "u" })).toThrow(/No current link/);
    const d = decideLink(a.project, a.link.id, "accepted", { decidedBy: "u" });
    expect(() => decideLink(d.project, a.link.id, "rejected", { decidedBy: "u" })).toThrow(/superseded/);
    expect(decideLink(d.project, d.link.id, "accepted", { decidedBy: "u" }).project).toBe(d.project);
  });
  it("a rejected pair is remembered and not re-suggested", () => {
    const a = addLink(base(), { personId: "p1", personaId: "x1" });
    const r = decideLink(a.project, a.link.id, "rejected", { decidedBy: "u" });
    expect(isRejectedPair(r.project, "p1", "x1")).toBe(true);
    expect(isRejectedPair(r.project, "p1", "x2")).toBe(false);
    expect(addLink(r.project, { personId: "p1", personaId: "x1" }).project).toBe(r.project); // existing (rejected) link blocks a new candidate
  });
  it("orders accepted personas by decision time (the first one identified comes first)", () => {
    let p = base();
    const l1 = addLink(p, { personId: "p1", personaId: "late" }); p = l1.project;
    const l2 = addLink(p, { personId: "p1", personaId: "early" }); p = l2.project;
    p = decideLink(p, l2.link.id, "accepted", { decidedBy: "u" }).project;
    p = decideLink(p, l1.link.id, "accepted", { decidedBy: "u" }).project;
    expect(acceptedLinksInOrder(p, "p1").map((l) => l.personaId)).toEqual(["early", "late"]);
  });
});

describe("other conclusion lists", () => {
  it("relationships start as candidates and validate input", () => {
    const { project, item } = addRelationship(base(), { personAId: "p1", personBId: "p2", type: "godparent", rationale: "named in the baptism" });
    expect(item).toMatchObject({ status: "candidate", type: "godparent" });
    expect(project.relationships).toEqual([item]);
    expect(() => addRelationship(base(), { personAId: "p1", personBId: "p1" })).toThrow();
    expect(() => addRelationship(base(), { personAId: "p1", personBId: "p2", type: "friend" })).toThrow(/unknown/);
  });
  it("conclusion evidence links assertions to conclusions, once, with a stance", () => {
    const a = addConclusionEvidence(base(), { conclusion: { kind: "link", id: "l1" }, assertionId: "as1" });
    expect(a.item).toMatchObject({ stance: "supports", conclusion: { kind: "link", id: "l1" }, assertionId: "as1" });
    expect(addConclusionEvidence(a.project, { conclusion: { kind: "link", id: "l1" }, assertionId: "as1" }).project).toBe(a.project);
    const c = addConclusionEvidence(a.project, { conclusion: { kind: "link", id: "l1" }, assertionId: "as2", stance: "contradicts" });
    expect(c.project.conclusionEvidence).toHaveLength(2);
    expect(() => addConclusionEvidence(base(), { conclusion: { kind: "person", id: "p" }, assertionId: "a" })).toThrow();
    expect(() => addConclusionEvidence(base(), { conclusion: { kind: "fact", id: "f" }, assertionId: "a", stance: "maybe" })).toThrow(/stance/);
  });
  it("proof notes keep the reasoning and the conclusions it concerns", () => {
    const { project, item } = addProofNote(base(), { subjects: [{ kind: "link", id: "l1" }, { kind: "family", id: "f1" }], text: "  Two baptisms conflict; the later register is a copy.  " });
    expect(item.text).toBe("Two baptisms conflict; the later register is a copy.");
    expect(item.subjects).toHaveLength(2);
    expect(project.proofNotes).toEqual([item]);
    expect(() => addProofNote(base(), { text: " " })).toThrow();
  });
});
