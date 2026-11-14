import { describe, it, expect, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { freshStorage } from "./evidenceHelpers.js";
import { fakeDirectory, fakeFile, memoryDeviceStorage, fixtureBytes } from "./ingestHelpers.js";
import { createEvidenceLibrary } from "../evidence/index.js";
import DocumentsSection from "../components/evidence/DocumentsSection.jsx";

let storage, library;
beforeEach(() => { storage = memoryDeviceStorage(freshStorage()); library = createEvidenceLibrary(storage); });
afterEach(() => cleanup());

/** Stub engines: DOCX text and PNG size, no PDF. OCR is scripted per test. */
function services(ocr) {
  const engines = {
    docxText: async () => "Ștefan Hariton s-a născut la Săhăteni în 1850.",
    imageSize: async () => ({ width: 1000, height: 300 }),
    openPdf: async () => { throw new Error("no PDF engine in this test"); },
  };
  return async () => ({ engines, ocr });
}
function ocrStub({ fail = () => false, gate } = {}) {
  let n = 0;
  return {
    calls: () => n,
    reset() {},
    async recognize({ width, height }) {
      n++;
      if (gate) await gate;
      if (fail(n)) throw new Error("OCR engine error: language data unavailable");
      return { text: "Ștefan Hariton", confidence: 90, words: [{ text: "Ștefan", bbox: { x0: 10, y0: 10, x1: 0.2 * width, y1: 0.2 * height } }], raw: "{}" };
    },
    async terminate() {},
  };
}
const addFiles = (files) => {
  const input = screen.getByTestId("doc-files");
  Object.defineProperty(input, "files", { value: files, configurable: true });
  fireEvent.change(input);
};
const status = (re) => waitFor(() => expect(screen.getByTestId("documents-status").textContent).toMatch(re), { timeout: 4000 });

describe("Documents section (P5.T6)", () => {
  it("adds files to the Inbox, sets a source, reads a DOCX and an image, and shows pages read", async () => {
    const ocr = ocrStub();
    render(<DocumentsSection storage={storage} library={library} services={services(ocr)} />);
    addFiles([fakeFile("note.docx", fixtureBytes("note.docx")), fakeFile("scan.png", fixtureBytes("scan.png")), fakeFile("vechi.doc", "x")]);
    await status(/Added: 2 new, 0 already known, 1 skipped \(doc\)\./);
    expect(screen.getAllByText(/Inbox — which source is this from\?/)).toHaveLength(2);

    fireEvent.change(screen.getByLabelText("Source title for note.docx"), { target: { value: "Notă de cercetare" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Set source" })[0]);
    await status(/"note.docx" belongs to "Notă de cercetare"/);
    expect(screen.getByText("Source: Notă de cercetare")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Read 2 unread" }));
    await status(/^Read 2 pages\.$/);
    expect(screen.getAllByText("1/1 pages read")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /unread/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Read note.docx" }).textContent).toBe("Read again");
    expect(ocr.calls()).toBe(1);                                         // only the image needed OCR
    expect(screen.getByText(/Page image cache: 1 images/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear cache" }));
    await status(/Removed 1 cached page images/);
  });

  it("a failed page appears under the runs with Re-run page, which reads it as a one-page batch", async () => {
    const ocr = ocrStub({ fail: (n) => n === 1 });
    render(<DocumentsSection storage={storage} library={library} services={services(ocr)} />);
    addFiles([fakeFile("scan.png", fixtureBytes("scan.png"))]);
    await status(/Added: 1 new/);
    fireEvent.click(screen.getByRole("button", { name: "Read scan.png" }));
    await status(/Read 0 pages, 1 failed \(see runs below\)/);
    expect(screen.getByTestId("runs").textContent).toMatch(/some pages failed/);
    expect(screen.getByText(/OCR engine error: language data unavailable/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Re-run page" }));
    await status(/^Page read\.$/);
    expect(screen.getByText("1/1 pages read")).toBeTruthy();
  });

  it("duplicates: a same-name file with different content offers Keep both and Replace old", async () => {
    render(<DocumentsSection storage={storage} library={library} services={services(ocrStub())} />);
    addFiles([fakeFile("scan.png", fixtureBytes("scan.png"))]);
    await status(/Added: 1 new/);
    const other = fixtureBytes("scan.png").slice(); other[100] ^= 1;
    addFiles([fakeFile("scan.png", other)]);
    await status(/1 flagged as a possible new version/);
    expect(screen.getByText("Same name as another file, different content.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Replace old" }));
    await status(/The new file replaces the old one/);
    expect(screen.getAllByRole("listitem").filter((li) => li.textContent.includes("scan.png"))).toHaveLength(1); // the replaced copy is no longer listed
  });

  it("links a folder through the picker, scans it, and reads a folder file", async () => {
    const dir = fakeDirectory({ "Registre": { "scan.png": fixtureBytes("scan.png"), "scan.png.meta.json": '{"sourceTitle":"Registrul de botezuri 1850"}' }, "vechi.doc": "x" }, "Genealogie");
    render(<DocumentsSection storage={storage} library={library} services={services(ocrStub())} picker={async () => dir} />);
    fireEvent.click(await screen.findByRole("button", { name: "Link documents folder" }));
    await status(/Linked "Genealogie"/);
    expect(screen.getByText("Genealogie")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Scan folder" }));
    await status(/^Scan: 1 new, 0 already known, 1 skipped \(doc\)\.$/);
    expect(screen.getByText("Source: Registrul de botezuri 1850")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Read scan.png" }));
    await status(/^Read 1 pages\.$/);
    fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
    await status(/Folder unlinked/);
    expect(screen.getByRole("button", { name: "Link documents folder" })).toBeTruthy();
    expect(screen.getByText("scan.png")).toBeTruthy();                   // registered documents stay
  });

  it("without folder support it says so and still offers Add files", async () => {
    render(<DocumentsSection storage={storage} library={library} services={services(ocrStub())} />);
    expect(screen.getByText(/This browser cannot link a folder/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add files…" })).toBeTruthy();
  });

  it("shows progress with a Cancel button while busy; cancelling stops the batch", async () => {
    let open; const gate = new Promise((r) => { open = r; });
    const ocr = ocrStub({ gate });
    render(<DocumentsSection storage={storage} library={library} services={services(ocr)} />);
    addFiles([fakeFile("a.png", fixtureBytes("scan.png")), fakeFile("b.png", fixtureBytes("scan.png").map((x, i) => (i === 120 ? x ^ 1 : x)))]);
    await status(/Added: 2 new/);
    fireEvent.click(screen.getByRole("button", { name: "Read 2 unread" }));
    const bar = await screen.findByRole("progressbar", { name: "Reading" });
    expect(bar.textContent).toMatch(/Reading…/);
    await waitFor(() => expect(ocr.calls()).toBe(1));                     // the first page is being read
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    open();
    await status(/Stopped\.$/);
    expect(ocr.calls()).toBe(1);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
