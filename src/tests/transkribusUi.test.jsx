import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { freshStorage } from "./evidenceHelpers.js";
import { fakeFile, memoryDeviceStorage, fixtureBytes } from "./ingestHelpers.js";
import { createEvidenceLibrary } from "../evidence/index.js";
import DocumentsSection from "../components/evidence/DocumentsSection.jsx";

const fx = (n) => fs.readFileSync(path.join(__dirname, "fixtures", "transkribus", n), "utf8");
let storage, library;
beforeEach(() => {
  storage = memoryDeviceStorage(freshStorage()); library = createEvidenceLibrary(storage);
  globalThis.URL.createObjectURL = vi.fn(() => "blob:page");
  globalThis.URL.revokeObjectURL = vi.fn();
});
afterEach(() => cleanup());

const services = (size = { width: 1475, height: 2320 }) => async () => ({
  engines: { imageSize: async () => size, docxText: async () => "", openPdf: async () => { throw new Error("no PDF"); } },
  ocr: { reset() {}, async terminate() {}, async recognize() { return { text: "REGISTRU STAREKI noise", confidence: 34, words: [{ text: "REGISTRU", bbox: { x0: 10, y0: 10, x1: 300, y1: 60 } }], raw: "{}" }; } },
});
const status = (re) => waitFor(() => expect(screen.getByTestId("documents-status").textContent).toMatch(re), { timeout: 4000 });
const pick = (testId, files) => {
  const input = screen.getByTestId(testId);
  Object.defineProperty(input, "files", { value: files, configurable: true });
  fireEvent.change(input);
};
const xmlFile = (name, text) => ({ name, text: async () => text, arrayBuffer: async () => new TextEncoder().encode(text).buffer });

async function readPng(size) {
  render(<DocumentsSection storage={storage} library={library} services={services(size)} />);
  pick("doc-files", [fakeFile("pag32-upright.png", fixtureBytes("scan.png"))]);
  await status(/Added: 1 new/);
  fireEvent.click(screen.getByRole("button", { name: "Read pag32-upright.png" }));
  await status(/^Read 1 pages/);
}

describe("Transkribus import UI (P7b.T4)", () => {
  it("matches by file name, imports, and the transcription shows with its line boxes", async () => {
    await readPng();
    pick("transkribus-files", [xmlFile("0001_pag32-upright.xml", fx("p32-2013.xml"))]);
    const panel = await screen.findByTestId("transkribus-panel");
    const matched = await within(panel).findByTestId("transkribus-matched");
    expect(matched.textContent).toMatch(/0001_pag32-upright\.xml → pag32-upright\.png, page 1 \(file name, 4 lines\)/);
    expect(within(matched).getByRole("checkbox").checked).toBe(true);
    fireEvent.click(within(panel).getByRole("button", { name: "Import 1 page" }));
    await status(/^Imported 1 page\. In Review text you can start your reading from it\.$/);
    expect(screen.queryByTestId("transkribus-panel")).toBeNull();

    // re-import: skipped
    pick("transkribus-files", [xmlFile("0001_pag32-upright.xml", fx("p32-2013.xml"))]);
    fireEvent.click(await within(await screen.findByTestId("transkribus-panel")).findByRole("button", { name: "Import 1 page" }));
    await status(/^Imported 0 pages; 1 already imported\.$/);

    fireEvent.click(screen.getByRole("button", { name: "Review text of pag32-upright.png" }));
    const ws = await screen.findByTestId("text-review");
    await waitFor(() => expect(within(ws).getByRole("img")).toBeTruthy());
    fireEvent.click(within(ws).getByRole("tab", { name: "Transcription (as read)" }));
    const select = await within(ws).findByLabelText("Transcription shown");
    expect(select.options[0].textContent).toMatch(/^transkribus \(prov=READ-COOP:name=PyLaia/);
    expect(within(ws).getByTestId("transcription-text").textContent).toMatch(/^Actu de încetare din viață\./);
    fireEvent.click(within(ws).getByLabelText(/Show line boxes on the image \(4\)/));
    expect(within(ws).getAllByTestId("line-box")).toHaveLength(4);
    expect(within(ws).getAllByTestId("line-box")[1].title).toMatch(/^Anulu una mie/);

    // no reading yet: it is offered from the Transkribus text, one click (Phase 7b review)
    fireEvent.click(within(ws).getByRole("tab", { name: "Modern reading" }));
    fireEvent.click(await within(ws).findByRole("button", { name: "Start my reading from the Transkribus text" }));
    await waitFor(() => expect(within(ws).getByText(/Reading started from the Transkribus text/)).toBeTruthy());
  });

  it("a different-shaped image is listed unticked; unmatched pages show the reason; page order onto a chosen document", async () => {
    await readPng({ width: 1000, height: 1400 });
    pick("transkribus-files", [xmlFile("0001_pag32-upright.xml", fx("p32-2013.xml")), xmlFile("0002_other.xml", fx("prefixed-2019.xml"))]);
    const panel = await screen.findByTestId("transkribus-panel");
    const matched = await within(panel).findByTestId("transkribus-matched");
    expect(matched.textContent).toMatch(/different shape; tick only if it is the same scan/);
    expect(within(matched).getByRole("checkbox").checked).toBe(false);
    expect(within(panel).getByTestId("transkribus-unmatched").textContent).toMatch(/0002_other\.xml: no document named "0002_registru\.jpg"; pick a document/);
    expect(within(panel).getByRole("button", { name: "Import 0 pages" }).disabled).toBe(true);

    fireEvent.change(within(panel).getByLabelText("Match by page order onto"), { target: { value: (await library.copies.listCurrent())[0].id } });
    await waitFor(() => expect(within(panel).getByText(/2 pages to place and "pag32-upright.png" has 1/)).toBeTruthy());
    fireEvent.click(within(panel).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("transkribus-panel")).toBeNull();
  });
});
