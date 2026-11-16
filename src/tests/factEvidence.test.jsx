import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { freshStorage } from "./evidenceHelpers.js";
import { createEvidenceLibrary, toEvidence, writeRecords } from "../evidence/index.js";
import { attachAssertionToFact, attachToProject, factEvidence, searchConfirmedEvidence, factRefOf } from "../conclusions/factEvidence.js";
import FactEvidence from "../components/evidence/FactEvidence.jsx";
import { ItemModal } from "../components/ItemModal.jsx";
import { checkUserActionOnly } from "./archRules.js";

const DEATH = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "extraction", "death-1866.json"), "utf8"));
let storage, library, source, deathDate, nameA;
beforeEach(async () => {
  storage = freshStorage(); library = createEvidenceLibrary(storage);
  source = await library.sources.create({ title: "Registrul stării civile, Craiova, decese 1866", kind: "civil-register" });
  const copy = (await library.copies.registerFile(new TextEncoder().encode("p32"), { sourceId: source.id, storage: { mode: "blob", blobKey: "k" } })).copy;
  const { wholePageRegion } = await library.pages.addPage({ copyId: copy.id, pageIndex: 31, label: "32", width: 1000, height: 1400 });
  const run = await library.runs.startRun({ processor: "llm-extraction" });
  await writeRecords({ library, runId: run.id, regionId: wholePageRegion.id, records: toEvidence(DEATH), addAssertion: (i) => library.assertions.propose(i) });
  const proposed = await library.assertions.listByStatus("proposed");
  deathDate = proposed.find((a) => a.property === "event.date");
  nameA = proposed.find((a) => a.property === "name" && a.originalValue === "Șfatu Loti");
  await library.assertions.confirmAssertion(deathDate.id, { decidedBy: "user" });
  await library.assertions.confirmAssertion(nameA.id, { decidedBy: "user" });
});
afterEach(() => cleanup());

const project = () => ({
  people: [{ id: "i1", name: "Loti Șfatu", birth: { year: 1804, place: "" }, death: { year: 1866, place: "Craiova" }, events: [{ id: "e1", label: "Burial", year: 1866 }], periods: [], groups: [] }],
  conclusionEvidence: [],
});

describe("evidence on timeline facts (P6.T5)", () => {
  it("finds confirmed evidence by any word of a name, with where it was read", async () => {
    expect((await library.records.searchPersonas("loti")).map((p) => p.nameAsWritten)).toEqual(["Șfatu Loti"]);
    expect(await library.records.searchPersonas("sfatu loti")).toHaveLength(1);
    const found = await searchConfirmedEvidence(library, "Loti");
    expect(found.map((f) => f.assertion.property).sort()).toEqual(["event.date", "name"]);   // only the confirmed ones
    const date = found.find((f) => f.assertion.property === "event.date");
    expect(date).toMatchObject({ source: { title: source.title }, page: { pageIndex: 31, label: "32" }, record: { kind: "death" } });
  });

  it("attaches only confirmed evidence, once, to birth/death or a listed fact, with a conclusionEvidence entry", async () => {
    const p1 = await attachAssertionToFact({ library, project: project(), personId: "i1", kind: "death", assertionId: deathDate.id });
    expect(p1.people[0].death).toEqual({ year: 1866, place: "Craiova", assertionIds: [deathDate.id] });   // values untouched
    expect(p1.conclusionEvidence).toEqual([expect.objectContaining({ conclusion: { kind: "fact", id: "i1#death" }, assertionId: deathDate.id, stance: "supports" })]);
    const p2 = attachToProject(p1, { personId: "i1", kind: "death", assertionId: deathDate.id });
    expect(p2.people[0].death.assertionIds).toEqual([deathDate.id]);
    expect(p2.conclusionEvidence).toHaveLength(1);
    const p3 = await attachAssertionToFact({ library, project: p2, personId: "i1", kind: "event", factId: "e1", assertionId: nameA.id });
    expect(p3.people[0].events[0].assertionIds).toEqual([nameA.id]);
    expect(factRefOf("i1", "event", "e1")).toBe("i1#event:e1");

    const stillProposed = (await library.assertions.listByStatus("proposed"))[0];
    await expect(attachAssertionToFact({ library, project: project(), personId: "i1", kind: "death", assertionId: stillProposed.id })).rejects.toThrow(/only confirmed/);
    await expect(attachAssertionToFact({ library, project: project(), personId: "i1", kind: "event", factId: "nope", assertionId: nameA.id })).rejects.toThrow(/no longer exists/);
    expect((await factEvidence(library, p3.people[0].death)).map((x) => x.assertion.id)).toEqual([deathDate.id]);
  });

  it("I6: automated code may not attach evidence to facts", () => {
    expect(checkUserActionOnly({ "extract/y.js": "attachAssertionToFact({ library, project })" })).toHaveLength(1);
  });

  it("the Evidence section searches, attaches and lists", async () => {
    const onAttach = vi.fn(async () => {});
    render(<FactEvidence storage={storage} fact={{ year: 1866 }} defaultQuery="Loti" onAttach={onAttach} />);
    const box = await screen.findByTestId("fact-evidence");
    await within(box).findByText("No evidence attached to this fact yet.");
    fireEvent.click(within(box).getByRole("button", { name: "Attach evidence…" }));
    const results = await within(box).findByTestId("evidence-results");
    expect(results.textContent).toMatch(/Registrul stării civile, Craiova, decese 1866, page 32 \(32\)/);
    fireEvent.click(within(results).getByRole("button", { name: /^Attach date/ }));
    await waitFor(() => expect(within(box).getByTestId("fact-evidence-status").textContent).toMatch(/Attached/));
    expect(onAttach).toHaveBeenCalledWith(deathDate.id);
    await waitFor(() => expect(within(box).getAllByTestId("evidence-row")[0].textContent).toMatch(/death record · date/));
  });

  it("the item editor shows the Evidence section only when the evidence layer is on", async () => {
    const descriptor = { mode: "edit", kind: "death", laneKey: "p:i1", laneId: "i1", laneIsPerson: true, item: { year: 1866, place: "Craiova", assertionIds: [deathDate.id] } };
    const { unmount } = render(<ItemModal descriptor={descriptor} storage={storage} onSave={() => {}} onDelete={() => {}} onClose={() => {}} />);
    expect(screen.queryByTestId("fact-evidence")).toBeNull();
    unmount();
    const onAttach = vi.fn(async () => {});
    render(<ItemModal descriptor={descriptor} storage={storage} onSave={() => {}} onDelete={() => {}} onClose={() => {}} evidence={{ onAttach, defaultQuery: "Loti" }} />);
    const box = await screen.findByTestId("fact-evidence", {}, { timeout: 4000 });
    await waitFor(() => expect(within(box).getAllByTestId("evidence-row")).toHaveLength(1));
    expect(within(box).getByRole("button", { name: "Attach evidence…" })).toBeTruthy();
  });
});
