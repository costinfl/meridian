import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { freshStorage } from "./evidenceHelpers.js";
import { fakeFile, memoryDeviceStorage, fixtureBytes } from "./ingestHelpers.js";
import { createEvidenceLibrary } from "../evidence/index.js";
import DocumentsSection from "../components/evidence/DocumentsSection.jsx";
import { segmentsOf } from "../components/evidence/TextReview.jsx";

const OCR_TEXT = "Anulu una mie optu sute șaizeci și șase\nD-ei [Lati? Sati?] [Ifapu?] Catolică";

let storage, library;
beforeEach(() => {
  storage = memoryDeviceStorage(freshStorage()); library = createEvidenceLibrary(storage);
  globalThis.URL.createObjectURL = vi.fn(() => "blob:page");
  globalThis.URL.revokeObjectURL = vi.fn();
});
afterEach(() => cleanup());

function services() {
  const engines = { imageSize: async () => ({ width: 1000, height: 1400 }), docxText: async () => "", openPdf: async () => { throw new Error("no PDF"); } };
  const ocr = {
    reset() {}, async terminate() {},
    async recognize() { return { text: OCR_TEXT, confidence: 35, words: [], raw: "{}" }; },   // low confidence, like handwriting
  };
  return async () => ({ engines, ocr });
}
const addFiles = (files) => {
  const input = screen.getByTestId("doc-files");
  Object.defineProperty(input, "files", { value: files, configurable: true });
  fireEvent.change(input);
};
const status = (re) => waitFor(() => expect(screen.getByTestId("documents-status").textContent).toMatch(re), { timeout: 4000 });
const reviewStatus = (re) => waitFor(() => expect(screen.getByTestId("review-status").textContent).toMatch(re), { timeout: 4000 });

describe("segmentsOf", () => {
  it("splits text into plain, uncertain and annotated parts that cover the text exactly", () => {
    const text = "a [b] c [d] e";
    const segs = segmentsOf(text, [{ id: "x", start: 8, end: 11, before: "q", after: "[d]" }]);
    expect(segs.map((s) => [s.type, text.slice(s.start, s.end)])).toEqual([["plain", "a "], ["uncertain", "[b]"], ["plain", " c "], ["annotated", "[d]"], ["plain", " e"]]);
    expect(segmentsOf("", [])).toEqual([]);
  });
});

describe("Review text (P5.T7)", () => {
  it("flags doubtful OCR, keeps the transcription, and saves sourced corrections as new reading versions", async () => {
    render(<DocumentsSection storage={storage} library={library} services={services()} />);
    addFiles([fakeFile("pag32.png", fixtureBytes("scan.png"))]);
    await status(/Added: 1 new/);
    fireEvent.click(screen.getByRole("button", { name: "Read pag32.png" }));
    await status(/^Read 1 pages\.$/);
    expect(screen.getByTestId("needs-review").textContent).toBe("needs review");

    fireEvent.click(screen.getByRole("button", { name: "Review text of pag32.png" }));
    const dialog = await screen.findByTestId("text-review");
    await waitFor(() => expect(within(dialog).getByRole("img")).toBeTruthy());     // the cached page image OCR used
    const start = await within(dialog).findByRole("button", { name: "Start reading from transcription" });
    expect(within(dialog).getByText(/looks doubtful \(confidence 35%\)/)).toBeTruthy();
    fireEvent.click(start);
    await reviewStatus(/Reading started/);

    // correct the first uncertain fragment, citing the archive
    fireEvent.click(within(dialog).getByText("[Lati? Sati?]"));
    fireEvent.change(within(dialog).getByLabelText("Correct text"), { target: { value: "Șfatu" } });
    fireEvent.change(within(dialog).getByLabelText("Source link"), { target: { value: "javascript:alert(1)" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save correction" }));
    await reviewStatus(/^Not saved: the link must start with https/);
    fireEvent.change(within(dialog).getByLabelText("Source link"), { target: { value: "https://arhive.example.ro/dolj/1866/32" } });
    fireEvent.change(within(dialog).getByLabelText("Note"), { target: { value: "name as given by the archive" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save correction" }));
    await reviewStatus(/Correction saved/);

    // and the second
    fireEvent.click(within(dialog).getByText("[Ifapu?]"));
    fireEvent.change(within(dialog).getByLabelText("Correct text"), { target: { value: "Loti" } });
    fireEvent.change(within(dialog).getByLabelText("Source link"), { target: { value: "https://arhive.example.ro/dolj/1866/32" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save correction" }));
    await reviewStatus(/Correction saved/);

    expect(within(dialog).getByTestId("reading-text").textContent).toMatch(/^Anulu una mie optu sute șaizeci și șase\nD-ei Șfatu↗ Loti↗ Catolică$/);
    expect(within(dialog).getAllByTestId("annotated").map((e) => e.textContent)).toEqual(["Șfatu", "Loti"]);
    expect(within(dialog).getByTestId("corrections").textContent).toMatch(/\[Lati\? Sati\?\] → Șfatu · name as given by the archive · source/);
    expect(within(dialog).getByTestId("history").textContent).toMatch(/History \(3 versions\)/);

    // the transcription is exactly what OCR read
    fireEvent.click(within(dialog).getByRole("tab", { name: "Transcription (as read)" }));
    expect(within(dialog).getByTestId("transcription-text").textContent).toBe(OCR_TEXT);
    expect(within(dialog).getByText(/Needs review/)).toBeTruthy();

    // stored: the transcription is unchanged, the reading has its two annotations
    const page = (await library.pages.listPages((await library.copies.listCurrent())[0].id))[0];
    const region = await library.pages.wholePageRegion(page.id);
    expect((await library.textLayers.current(region.id)).originalText).toBe(OCR_TEXT);
    const reading = await library.textLayers.current(region.id, "reading");
    expect(reading.annotations.map((a) => [a.before, a.after, a.url])).toEqual([
      ["[Lati? Sati?]", "Șfatu", "https://arhive.example.ro/dolj/1866/32"],
      ["[Ifapu?]", "Loti", "https://arhive.example.ro/dolj/1866/32"],
    ]);

    // closing refreshes the list: the page is reviewed now
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByTestId("text-review")).toBeNull());
    await waitFor(() => expect(screen.getByText("1 reviewed")).toBeTruthy());
    expect(screen.queryByTestId("needs-review")).toBeNull();
  });

  it("Edit whole text saves a typed version; an unchanged text adds nothing", async () => {
    render(<DocumentsSection storage={storage} library={library} services={services()} />);
    addFiles([fakeFile("p.png", fixtureBytes("scan.png"))]);
    await status(/Added: 1 new/);
    fireEvent.click(screen.getByRole("button", { name: "Read p.png" }));
    await status(/^Read 1 pages\.$/);
    fireEvent.click(screen.getByRole("button", { name: "Review text of p.png" }));
    const dialog = await screen.findByTestId("text-review");
    fireEvent.click(await within(dialog).findByRole("button", { name: "Start reading from transcription" }));
    await reviewStatus(/Reading started/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Edit whole text" }));
    fireEvent.change(within(dialog).getByLabelText("Reading text"), { target: { value: "Anul una mie opt sute șaizeci și șase" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save text" }));
    await reviewStatus(/Text saved/);
    expect(within(dialog).getByTestId("reading-text").textContent).toBe("Anul una mie opt sute șaizeci și șase");
    expect(within(dialog).getByTestId("history").textContent).toMatch(/History \(2 versions\)/);
  });
});
