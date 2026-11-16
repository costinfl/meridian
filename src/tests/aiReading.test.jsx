import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { freshStorage } from "./evidenceHelpers.js";
import { fakeFile, memoryDeviceStorage, fixtureBytes } from "./ingestHelpers.js";
import { createEvidenceLibrary } from "../evidence/index.js";
import * as extract from "../extract/index.js";
import DocumentsSection from "../components/evidence/DocumentsSection.jsx";
import { checkUserActionOnly } from "./archRules.js";
import { confirmAndSend, openReview } from "./workspaceHelpers.js";

const AI = {
  transcription: "Actu de încetare din viață.\nAnulu una mie optu sute șaizeci și șase la douădieci și optu ale lunii\nMartie … D-ei [Lati? Sati?] [Ifapu?] Catolică",
  modernReading: "Act de deces. În anul 1866, la 28 martie … dna [Lati? Sati?] [Ifapu?], catolică",
  notes: "The deceased's name is hard to read.",
};
const IMG = { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png", width: 10, height: 10 };
const stub = (answer = AI) => { const calls = []; return { calls, provider: "anthropic", model: "claude-opus-5-5", async complete(r) { calls.push(r); return { json: answer, rawText: JSON.stringify(answer), usage: {} }; } }; };

describe("AI page reading (P6.T6)", () => {
  let library, copy, page, whole, ocr;
  beforeEach(async () => {
    library = createEvidenceLibrary(freshStorage());
    copy = (await library.copies.registerFile(new TextEncoder().encode("p"), { storage: { mode: "blob", blobKey: "k" } })).copy;
    ({ page, wholePageRegion: whole } = await library.pages.addPage({ copyId: copy.id, pageIndex: 0, width: 10, height: 10 }));
    const run = await library.runs.startRun({ processor: "tesseract" });
    ocr = await library.textLayers.add({ regionId: whole.id, runId: run.id, originalText: "REGISTRU STAREKI CIVILE noise", confidence: 0.34 });
  });

  it("stores the AI transcription as a new transcription layer with the modern reading only proposed", async () => {
    const client = stub();
    const s = await extract.readPagesWithAi({ library, copy, client, loadImage: async () => IMG });
    expect(s.pages[0]).toMatchObject({ status: "succeeded", notes: AI.notes });
    expect(client.calls[0].text).toMatch(/Earlier machine reading \(OCR, may be wrong\)[\s\S]*REGISTRU STAREKI/);
    expect(client.calls[0].system).toMatch(/diplomatic transcription/);
    const current = await library.textLayers.current(whole.id);
    expect(current).toMatchObject({ kind: "transcription", originalText: AI.transcription, proposedReading: AI.modernReading });
    expect((await library.runs.getRun(current.runId))).toMatchObject({ processor: "llm-reading", processorVersion: "reading-v1", modelId: "anthropic:claude-opus-5-5", status: "succeeded" });
    expect(await library.textLayers.get(ocr.id)).toEqual(ocr);                    // the OCR layer stays
    expect(await library.textLayers.current(whole.id, "reading")).toBeNull();      // nothing applied without the user
    const again = await extract.readPagesWithAi({ library, copy, client, loadImage: async () => IMG });
    expect(again).toMatchObject({ alreadyRead: 1, pages: [] });
  });

  it("an unusable answer fails the page; a dry run sends nothing", async () => {
    const bad = await extract.readPagesWithAi({ library, copy, client: stub({ transcription: "", modernReading: "x" }), loadImage: async () => IMG });
    expect(bad.pages[0]).toMatchObject({ status: "failed", error: "the transcription is empty" });
    const client = stub();
    const dry = await extract.readPagesWithAi({ library, copy, client, loadImage: async () => IMG, dryRun: true });
    expect(client.calls).toEqual([]);
    expect(dry.pages[0].estimatedInputTokens).toBeGreaterThan(1600);
    expect(extract.validateReading({ transcription: "a", modernReading: "b", extra: 1 }).errors).toEqual(["unexpected field 'extra'"]);
  });

  it("Use AI reading starts the reading, or adds a version of an existing one; brackets are kept", async () => {
    await extract.readPagesWithAi({ library, copy, client: stub(), loadImage: async () => IMG });
    const ai = await library.textLayers.current(whole.id);
    const r1 = await library.textLayers.adoptProposedReading({ regionId: whole.id, fromLayerId: ai.id });
    expect(r1).toMatchObject({ kind: "reading", originalText: AI.modernReading, startedFromLayerId: ai.id });
    expect(r1.originalText).toMatch(/\[Lati\? Sati\?\]/);
    expect((await library.textLayers.adoptProposedReading({ regionId: whole.id, fromLayerId: ai.id })).id).toBe(r1.id);   // same text: nothing new

    const fixed = await library.textLayers.rewriteReading({ readingId: r1.id, text: "my own text" });
    const r3 = await library.textLayers.adoptProposedReading({ regionId: whole.id, fromLayerId: ai.id });
    expect(r3).toMatchObject({ supersedesId: fixed.id, originalText: AI.modernReading });
    expect(await library.textLayers.listByRegion(whole.id, "reading")).toHaveLength(3);
    await expect(library.textLayers.adoptProposedReading({ regionId: whole.id, fromLayerId: ocr.id })).rejects.toMatchObject({ code: "not-found" });
    expect(checkUserActionOnly({ "extract/z.js": "library.textLayers.adoptProposedReading({ regionId, fromLayerId })" })).toHaveLength(1);
  });
});

describe("Read with AI in the panel (P6.T6)", () => {
  let storage, library;
  beforeEach(async () => {
    storage = memoryDeviceStorage(freshStorage()); library = createEvidenceLibrary(storage);
    globalThis.URL.createObjectURL = vi.fn(() => "blob:page");
    globalThis.URL.revokeObjectURL = vi.fn();
    await extract.saveAiSettings(storage, { keys: { anthropic: "sk-ant-api03-test-0000" } });
  });
  afterEach(() => cleanup());

  it("reads the document, offers the proposal on Review text, and applies it only on click", async () => {
    const services = async () => ({
      engines: { imageSize: async () => ({ width: 1000, height: 1400 }), docxText: async () => "", openPdf: async () => { throw new Error("no PDF"); } },
      ocr: { reset() {}, async terminate() {}, async recognize() { return { text: "REGISTRU noise", confidence: 34, words: [], raw: "{}" }; } },
    });
    const aiServices = async () => ({ ...extract, prepareImage: async (img) => img, clientFor: () => stub() });
    render(<DocumentsSection storage={storage} library={library} services={services} aiServices={aiServices} />);
    const input = screen.getByTestId("doc-files");
    Object.defineProperty(input, "files", { value: [fakeFile("pag32.png", fixtureBytes("scan.png"))], configurable: true });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByTestId("documents-status").textContent).toMatch(/Added: 1 new/));
    fireEvent.click(screen.getByRole("button", { name: "Read pag32.png" }));
    await waitFor(() => expect(screen.getByTestId("documents-status").textContent).toMatch(/^Read 1 pages/));
    expect(screen.queryByRole("button", { name: /with AI/ })).toBeNull();          // no bulk AI in the document list

    const dialog = await openReview("pag32.png");
    // OCR was poor (34%), so Read with AI is offered as the last resort, with the cost shown first
    const text = await confirmAndSend(dialog, "Read with AI (when OCR fails)");
    expect(text).toMatch(/Read this page with AI\?About [\d,]+ input tokens and a \d+ kB image .* will be sent to Anthropic Claude claude-opus-5-5/);
    await waitFor(() => expect(within(dialog).getByTestId("review-status").textContent).toMatch(/^AI read 1 page\./));
    const panel = await within(dialog).findByTestId("ai-proposal");
    expect(within(panel).getByTestId("ai-proposal-text").textContent).toBe(AI.modernReading);
    expect(within(dialog).queryByTestId("reading-text")).toBeNull();               // not applied yet
    fireEvent.click(within(panel).getByRole("button", { name: "Use AI reading" }));
    await waitFor(() => expect(within(dialog).getByTestId("reading-text").textContent).toBe(AI.modernReading));
    expect(within(dialog).queryByTestId("ai-proposal")).toBeNull();
    expect(within(dialog).getByText("[Lati? Sati?]")).toBeTruthy();                  // uncertain parts highlighted, ready to correct

    fireEvent.click(within(dialog).getByRole("tab", { name: "Transcription (as read)" }));
    expect(within(dialog).getByTestId("transcription-text").textContent).toBe(AI.transcription);
    const select = within(dialog).getByLabelText("Transcription shown");
    expect([...select.options].map((o) => o.textContent.split(" · ")[0].split(" ")[0])).toEqual(["llm-reading", "tesseract"]);
    expect(select.options[0].textContent).toMatch(/llm-reading \(claude-opus-5-5\) · .* · current/);
    fireEvent.change(select, { target: { value: select.options[1].value } });
    expect(within(dialog).getByTestId("transcription-text").textContent).toBe("REGISTRU noise");
  });
});
