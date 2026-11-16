import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { freshStorage } from "./evidenceHelpers.js";
import { fakeFile, memoryDeviceStorage, fixtureBytes } from "./ingestHelpers.js";
import { createEvidenceLibrary, correctAssertion, normalizedCorrection, toEvidence, writeRecords } from "../evidence/index.js";
import * as extract from "../extract/index.js";
import DocumentsSection from "../components/evidence/DocumentsSection.jsx";
import { cropStyle } from "../components/evidence/AssertionReview.jsx";
import { checkUserActionOnly } from "./archRules.js";
import { drawBox, confirmAndSend, openReview } from "./workspaceHelpers.js";

const DEATH = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "extraction", "death-1866.json"), "utf8"));

describe("review helpers (P6.T4)", () => {
  let library, whole, proposal;
  beforeEach(async () => {
    library = createEvidenceLibrary(freshStorage());
    const copy = (await library.copies.registerFile(new TextEncoder().encode("p"), { storage: { mode: "blob", blobKey: "k" } })).copy;
    ({ wholePageRegion: whole } = await library.pages.addPage({ copyId: copy.id, pageIndex: 0, width: 1000, height: 1400 }));
    const run = await library.runs.startRun({ processor: "llm-extraction" });
    await writeRecords({ library, runId: run.id, regionId: whole.id, records: toEvidence(DEATH), addAssertion: (i) => library.assertions.propose(i) });
    proposal = async (property, value) => (await library.assertions.listByStatus("proposed")).find((a) => a.property === property && (value == null || a.originalValue === value));
  });

  it("normalises corrected dates (Julian before 1919) and ages", () => {
    expect(normalizedCorrection("event.date", { asWritten: "27 Martie 1866", year: "1866", month: "3", day: "27" })).toMatchObject({ earliest: "1866-03-27", calendar: "julian" });
    expect(normalizedCorrection("age", { value: "63" })).toEqual({ value: 63, unit: "years" });
    expect(normalizedCorrection("name", {})).toBeUndefined();
    expect(() => normalizedCorrection("event.date", { year: "" })).toThrow(/year/);
  });

  it("a correction is a confirmed user assertion superseding the proposal, written by a manual run", async () => {
    const age = await proposal("age", "șaizeci și doi ani");
    const fixed = await correctAssertion({ library, assertionId: age.id, fields: { originalValue: "șaizeci și trei ani", value: "63" } });
    expect(fixed).toMatchObject({ status: "confirmed", agent: "manual", supersedesId: age.id, normalizedValue: { value: 63, unit: "years" }, citation: age.citation });
    expect((await library.assertions.get(age.id)).status).toBe("proposed");      // kept, superseded
    const current = await library.assertions.listCurrentBySubject(age.subjectId);
    expect(current.map((a) => a.id)).toContain(fixed.id);
    expect(current.map((a) => a.id)).not.toContain(age.id);
    const rel = await proposal("informantFor");
    await expect(correctAssertion({ library, assertionId: rel.id, fields: { originalValue: "x" } })).rejects.toThrow(/relation/);
    await expect(correctAssertion({ library, assertionId: age.id, fields: { originalValue: " " } })).rejects.toThrow();
  });

  it("I6: the architecture test blocks automated code from correcting", () => {
    expect(checkUserActionOnly({ "extract/x.js": "await correctAssertion({ library, assertionId, fields })" })).toHaveLength(1);
  });

  it("cropStyle shows the box of the page image", () => {
    const s = cropStyle("blob:x", { x0: 0.25, y0: 0.5, x1: 0.75, y1: 1 }, 1000, 1400, 200);
    expect(s).toMatchObject({ width: 200, height: 280, backgroundSize: "200% 200%", backgroundPosition: "50% 100%" });
  });
});

describe("review queue in the panel (P6.T4)", () => {
  let storage, library, answers;
  beforeEach(async () => {
    storage = memoryDeviceStorage(freshStorage()); library = createEvidenceLibrary(storage);
    globalThis.URL.createObjectURL = vi.fn(() => "blob:page");
    globalThis.URL.revokeObjectURL = vi.fn();
    await extract.saveAiSettings(storage, { keys: { anthropic: "sk-ant-api03-test-0000" } });
    answers = 0;
  });
  afterEach(() => cleanup());
  const services = () => async () => ({
    engines: { imageSize: async () => ({ width: 1000, height: 1400 }), docxText: async () => "", openPdf: async () => { throw new Error("no PDF"); } },
    ocr: { reset() {}, async terminate() {}, async recognize() { return { text: "noise", confidence: 30, words: [], raw: "{}" }; } },
  });
  const aiServices = async () => ({
    ...extract, prepareImage: async (img) => img,
    clientFor: () => ({ provider: "anthropic", model: "claude-opus-5-5", async complete() { answers++; return { json: DEATH, rawText: JSON.stringify(DEATH), usage: {} }; } }),
  });
  const status = (re) => waitFor(() => expect(screen.getByTestId("documents-status").textContent).toMatch(re), { timeout: 4000 });
  const recStatus = (dialog, re) => waitFor(() => expect(within(dialog).getByTestId("records-status").textContent).toMatch(re), { timeout: 4000 });

  it("nothing is confirmed until clicked; confirm, reject, correct and confirm all; a rejection is not proposed again", async () => {
    render(<DocumentsSection storage={storage} library={library} services={services()} aiServices={aiServices} />);
    const input = screen.getByTestId("doc-files");
    Object.defineProperty(input, "files", { value: [fakeFile("pag32.png", fixtureBytes("scan.png"))], configurable: true });
    fireEvent.change(input);
    await status(/Added: 1 new/);
    fireEvent.click(screen.getByRole("button", { name: "Read pag32.png" }));
    await status(/^Read 1 pages/);
    const ws = await openReview("pag32.png");
    fireEvent.click(within(ws).getByRole("tab", { name: "Records" }));
    await drawBox(ws);
    await confirmAndSend(ws, "Extract with AI");
    await recStatus(ws, /^Extracted 1 record/);
    fireEvent.click(within(ws).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.getByTestId("proposals-waiting")).toBeTruthy());
    const total = (await library.assertions.listByStatus("proposed")).length;
    expect(screen.getByTestId("proposals-waiting").textContent).toBe(`${total} proposed values waiting for review`);
    expect(await library.assertions.listByStatus("confirmed")).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: `Review ${total} proposals in pag32.png` }));
    const dialog = await screen.findByTestId("text-review");
    expect(within(dialog).getByRole("tab", { name: "Records" }).getAttribute("aria-selected")).toBe("true");
    const card = await within(dialog).findByTestId("record-card");
    await waitFor(() => expect(within(card).getByTestId("record-crop")).toBeTruthy());

    fireEvent.click(within(card).getByRole("button", { name: "Confirm name Constandin Cristescu" }));
    await recStatus(dialog, /^Confirmed\.$/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject event.place Craiova, în casa D. Drăgoiescu, Mahalaua [Brândușa?]" }));
    await recStatus(dialog, /Rejected\. It will not be proposed again/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Correct age șaizeci și doi ani" }));
    const form = within(dialog).getByTestId("correct-form");
    expect(within(form).getByLabelText("Corrected age").value).toBe("62");
    fireEvent.change(within(form).getByLabelText("Corrected value as written"), { target: { value: "șaizeci și trei ani" } });
    fireEvent.change(within(form).getByLabelText("Corrected age"), { target: { value: "63" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await recStatus(dialog, /Correction saved/);
    expect(within(dialog).getByTestId("record-card").textContent).toMatch(/șaizeci și trei ani/);

    const confirmAll = within(dialog).getByRole("button", { name: /Confirm all \d+ proposed values/ });
    fireEvent.click(confirmAll);
    await recStatus(dialog, /^Confirmed \d+ values\.$/);
    // only the corrected age's original proposal is still "proposed": it is kept, superseded by the correction
    expect((await library.assertions.listByStatus("proposed")).map((a) => [a.property, a.originalValue])).toEqual([["age", "șaizeci și doi ani"]]);
    expect(within(dialog).queryByRole("button", { name: /Confirm all/ })).toBeNull();
    expect((await library.assertions.listByStatus("rejected")).map((a) => a.property)).toEqual(["event.place"]);

    // extract the record's box again: the rejected place is not proposed again
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Show region" })[0]);
    await confirmAndSend(dialog, "Extract with AI");
    await recStatus(dialog, /\(1 you rejected before were not proposed again\)/);
    expect(answers).toBe(2);
    expect((await library.assertions.listByStatus("proposed")).some((a) => a.property === "event.place")).toBe(false);
  });
});
