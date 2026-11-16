import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { freshStorage } from "./evidenceHelpers.js";
import { fakeFile, memoryDeviceStorage, fixtureBytes } from "./ingestHelpers.js";
import { createEvidenceLibrary } from "../evidence/index.js";
import * as extract from "../extract/index.js";
import DocumentsSection, { describeExtraction } from "../components/evidence/DocumentsSection.jsx";
import AiSettings from "../components/evidence/AiSettings.jsx";
import { drawBox, confirmAndSend, openReview } from "./workspaceHelpers.js";
import { createProject } from "../models/project.js";
import { exportProjectZip } from "../share.js";

const DEATH = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "extraction", "death-1866.json"), "utf8"));
let storage, library, calls;
beforeEach(() => {
  storage = memoryDeviceStorage(freshStorage()); library = createEvidenceLibrary(storage); calls = [];
  globalThis.URL.createObjectURL = vi.fn(() => "blob:page");
  globalThis.URL.revokeObjectURL = vi.fn();
});
afterEach(() => cleanup());

function services() {
  const engines = { imageSize: async () => ({ width: 1000, height: 1400 }), docxText: async () => "", openPdf: async () => { throw new Error("no PDF"); } };
  const ocr = { reset() {}, async terminate() {}, async recognize() { return { text: "REGISTRU STAREKI CIVILE", confidence: 34, words: [], raw: "{}" }; } };
  return async () => ({ engines, ocr });
}
/** The real extraction module, with a stub provider client (no network) and no image re-encoding. */
const aiServices = async () => ({
  ...extract,
  prepareImage: async (img) => img,
  clientFor: (settings) => ({
    provider: settings.provider, model: settings.models[settings.provider],
    async complete(req) { calls.push(req); return { json: DEATH, rawText: JSON.stringify(DEATH), stopReason: "end_turn", model: "claude-opus-5-5", usage: { inputTokens: 1, outputTokens: 1 } }; },
  }),
});
const status = (re) => waitFor(() => expect(screen.getByTestId("documents-status").textContent).toMatch(re), { timeout: 4000 });

async function readOnePage() {
  render(<DocumentsSection storage={storage} library={library} services={services()} aiServices={aiServices} />);
  const input = screen.getByTestId("doc-files");
  Object.defineProperty(input, "files", { value: [fakeFile("pag32.png", fixtureBytes("scan.png"))], configurable: true });
  fireEvent.change(input);
  await status(/Added: 1 new/);
  fireEvent.click(screen.getByRole("button", { name: "Read pag32.png" }));
  await status(/^Read 1 pages\.$/);
}

describe("AI extraction on demand, on a box only (P6.T3, review follow-up)", () => {
  it("the document list has no AI buttons; Extract with AI needs a box, shows the cost first, and needs a key", async () => {
    await readOnePage();
    expect(screen.queryByRole("button", { name: /Extract records from|with AI|Dry run/ })).toBeNull();
    const dialog = await openReview("pag32.png");
    fireEvent.click(within(dialog).getByRole("tab", { name: "Records" }));
    const button = await within(dialog).findByRole("button", { name: "Extract with AI" });
    expect(button.disabled).toBe(true);
    expect(button.title).toMatch(/Draw a box/);

    await drawBox(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Extract with AI" }));
    const confirm = await within(dialog).findByTestId("ai-confirm");
    expect(confirm.textContent).toMatch(/Extract "Entry 1" with AI\?About [\d,]+ input tokens and a \d+ kB image .* will be sent to Anthropic Claude claude-opus-5-5\. Your provider charges for it\./);
    expect(confirm.textContent).toMatch(/Add your Anthropic Claude API key/);
    expect(within(confirm).getByRole("button", { name: "Send" }).disabled).toBe(true);
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(calls).toEqual([]);                                                       // nothing sent

    await extract.saveAiSettings(storage, { keys: { anthropic: "sk-ant-api03-test-key-0000" } });
    await confirmAndSend(dialog, "Extract with AI");
    await waitFor(() => expect(within(dialog).getByTestId("records-status").textContent).toMatch(/^Extracted 1 record with \d+ proposed values from 1 page\.$/));
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toMatch(/ONE REGION of the page/);
    expect(calls[0].text).not.toMatch(/STAMP or MARGIN NOTE/);
    const card = within(dialog).getByTestId("record-card");
    expect(card.textContent).toMatch(/death · 1866-03-26 \(julian\)/);
    expect(within(card).getAllByTestId("assertion-row").every((r) => /proposed · llm-extraction · 70%/.test(r.textContent))).toBe(true);
    expect(await library.assertions.listByStatus("confirmed")).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));             // the list refreshes on close
    await waitFor(() => expect(screen.getByTestId("runs").textContent).toMatch(/llm-extraction extraction-v1 · succeeded · 1 page/));
  });

  it("a stamp / margin note box tells the model it is a later annotation", async () => {
    await extract.saveAiSettings(storage, { keys: { anthropic: "sk-ant-api03-test-key-0000" } });
    await readOnePage();
    const dialog = await openReview("pag32.png");
    fireEvent.click(within(dialog).getByRole("tab", { name: "Records" }));
    await drawBox(dialog, { purpose: "annotation", from: [700, 100], to: [990, 400] });
    expect(within(dialog).getByText(/Margin note \/ stamp 1/)).toBeTruthy();
    const text = await confirmAndSend(dialog, "Extract with AI");
    expect(text).toMatch(/Extract "Margin note \/ stamp 1" with AI\?/);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].text).toMatch(/STAMP or MARGIN NOTE[\s\S]*marriage, an adoption, a death or a divorce/);
  });
});

describe("describeExtraction", () => {
  it("summarises results, failures, skips and limits", () => {
    expect(describeExtraction({ dryRun: false, pages: [{ status: "succeeded", records: 2, assertions: 20, skippedRejected: 3 }, { status: "failed", error: "The model declined this page" }], alreadyExtracted: 1, overLimit: 4 }))
      .toBe("Extracted 2 records with 20 proposed values from 1 page (3 you rejected before were not proposed again); 1 failed: The model declined this page. 1 already extracted (use Extract again); 4 over the page limit, run again for the rest.");
    expect(describeExtraction({ dryRun: true, pages: [], alreadyExtracted: 2, overLimit: 0 })).toBe("Dry run: nothing to send. 2 already extracted (use Extract again).");
  });
});

describe("AI settings section (I9)", () => {
  it("saves a key on the device only, shows it masked, removes it; a bundle export never contains it", async () => {
    render(<AiSettings storage={storage} />);
    const box = await screen.findByTestId("ai-settings");
    fireEvent.change(within(box).getByLabelText("Anthropic Claude API key"), { target: { value: "sk-ant-api03-SECRETSECRET-9999" } });
    fireEvent.click(within(box).getByRole("button", { name: "Save key" }));
    await waitFor(() => expect(within(box).getByTestId("saved-key").textContent).toBe("sk-ant…9999"));
    expect(box.textContent).not.toMatch(/SECRETSECRET/);

    const zip = await JSZip.loadAsync(await exportProjectZip(createProject("Test"), storage));
    for (const name of Object.keys(zip.files)) {
      const f = zip.file(name);
      if (f) expect(await f.async("string"), name).not.toMatch(/SECRETSECRET|aiSettings/);
    }

    fireEvent.change(within(box).getByLabelText("AI provider"), { target: { value: "openai" } });
    await waitFor(() => expect(within(box).getByLabelText("OpenAI API key")).toBeTruthy());
    expect(within(box).getByLabelText("AI model").value).toBe("");
    fireEvent.change(within(box).getByLabelText("AI provider"), { target: { value: "anthropic" } });
    fireEvent.click(await within(box).findByRole("button", { name: "Remove key" }));
    await waitFor(() => expect(within(box).getByLabelText("Anthropic Claude API key")).toBeTruthy());
    expect((await extract.getAiSettings(storage)).keys.anthropic).toBe("");
  });
});
