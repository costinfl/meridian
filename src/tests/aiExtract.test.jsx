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

describe("Extract records from the Documents list (P6.T3)", () => {
  it("asks for a key first; a dry run sends nothing; Extract proposes values and becomes Extract again", async () => {
    await readOnePage();
    fireEvent.click(screen.getByRole("button", { name: "Extract records from pag32.png" }));
    await status(/^Failed: Add your Anthropic Claude API key in AI settings\.$/);

    fireEvent.click(screen.getByRole("button", { name: "Dry run for pag32.png" }));
    await status(/^Dry run: would send 1 page \(images \d+ kB, about [\d,]+ input tokens\)\. Nothing was sent\.$/);
    expect(calls).toEqual([]);

    await extract.saveAiSettings(storage, { keys: { anthropic: "sk-ant-api03-test-key-0000" } });
    fireEvent.click(screen.getByRole("button", { name: "Extract records from pag32.png" }));
    await status(/^Extracted 1 record with \d+ proposed values from 1 page\.$/);
    expect(calls).toHaveLength(1);
    expect(calls[0].image.mediaType).toBe("image/png");
    await waitFor(() => expect(screen.getByRole("button", { name: "Extract records from pag32.png" }).textContent).toBe("Extract again"));
    expect((await library.assertions.listByStatus("proposed")).length).toBeGreaterThan(10);
    expect(await library.assertions.listByStatus("confirmed")).toEqual([]);

    // the run shows in the runs list with its processor
    expect(screen.getByTestId("runs").textContent).toMatch(/llm-extraction extraction-v1 · succeeded · 1 page/);
  });

  it("the page workspace extracts the selected page and lists the proposals", async () => {
    await extract.saveAiSettings(storage, { keys: { anthropic: "sk-ant-api03-test-key-0000" } });
    await readOnePage();
    fireEvent.click(screen.getByRole("button", { name: "Review text of pag32.png" }));
    const dialog = await screen.findByTestId("text-review");
    fireEvent.click(within(dialog).getByRole("tab", { name: "Records" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "Extract with AI" }));
    await waitFor(() => expect(within(dialog).getByTestId("records-status").textContent).toMatch(/Extracted 1 record/));
    const card = within(dialog).getByTestId("record-card");
    expect(card.textContent).toMatch(/death · 1866-03-26 \(julian\)/);
    expect(card.textContent).toMatch(/Șfatu Loti/);
    expect(within(card).getAllByTestId("assertion-row").every((r) => /proposed · llm-extraction · 70%/.test(r.textContent))).toBe(true);
    // the boxed record got its own region on the image
    expect(within(dialog).getAllByTestId("region-box")).toHaveLength(1);
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
