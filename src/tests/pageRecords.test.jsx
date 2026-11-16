import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { freshStorage } from "./evidenceHelpers.js";
import { fakeFile, memoryDeviceStorage, fixtureBytes } from "./ingestHelpers.js";
import { createEvidenceLibrary } from "../evidence/index.js";
import DocumentsSection from "../components/evidence/DocumentsSection.jsx";
import { boxFromDrag } from "../components/evidence/RegionOverlay.jsx";

let storage, library;
beforeEach(() => {
  storage = memoryDeviceStorage(freshStorage()); library = createEvidenceLibrary(storage);
  globalThis.URL.createObjectURL = vi.fn(() => "blob:page");
  globalThis.URL.revokeObjectURL = vi.fn();
});
afterEach(() => cleanup());

function services() {
  const engines = { imageSize: async () => ({ width: 1000, height: 1400 }), docxText: async () => "", openPdf: async () => { throw new Error("no PDF"); } };
  const ocr = { reset() {}, async terminate() {}, async recognize() { return { text: "Actu de încetare din viață", confidence: 80, words: [], raw: "{}" }; } };
  return async () => ({ engines, ocr });
}
const status = (re) => waitFor(() => expect(screen.getByTestId("documents-status").textContent).toMatch(re), { timeout: 4000 });

async function openWorkspace() {
  render(<DocumentsSection storage={storage} library={library} services={services()} />);
  const input = screen.getByTestId("doc-files");
  Object.defineProperty(input, "files", { value: [fakeFile("pag32.png", fixtureBytes("scan.png"))], configurable: true });
  fireEvent.change(input);
  await status(/Added: 1 new/);
  fireEvent.click(screen.getByRole("button", { name: "Read pag32.png" }));
  await status(/^Read 1 pages\.$/);
  fireEvent.click(screen.getByRole("button", { name: "Review text of pag32.png" }));
  const dialog = await screen.findByTestId("text-review");
  await waitFor(() => expect(within(dialog).getByRole("img")).toBeTruthy());
  fireEvent.click(within(dialog).getByRole("tab", { name: "Records" }));
  return dialog;
}

describe("boxFromDrag", () => {
  it("orders the corners, clamps to the page and ignores tiny boxes", () => {
    expect(boxFromDrag({ x: 0.8, y: 0.6 }, { x: 0.2, y: 0.1 })).toEqual({ x0: 0.2, y0: 0.1, x1: 0.8, y1: 0.6 });
    expect(boxFromDrag({ x: -0.2, y: 0.1 }, { x: 0.5, y: 1.3 })).toEqual({ x0: 0, y0: 0.1, x1: 0.5, y1: 1 });
    expect(boxFromDrag({ x: 0.5, y: 0.5 }, { x: 0.505, y: 0.6 })).toBeNull();
  });
});

describe("Records tab: draw a region and enter a record by hand (P6.T2)", () => {
  it("draws a region, enters the 1866 death record with a relation, and lists it confirmed", async () => {
    const dialog = await openWorkspace();
    expect(await within(dialog).findByText("No records on this page yet.")).toBeTruthy();

    // draw: the overlay is 1000 x 1400 px on screen
    fireEvent.click(within(dialog).getByRole("button", { name: "Draw entry box" }));
    const overlay = within(dialog).getByTestId("region-overlay");
    overlay.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 1400, right: 1000, bottom: 1400 });
    fireEvent.pointerDown(overlay, { clientX: 80, clientY: 182, pointerId: 1 });
    fireEvent.pointerMove(overlay, { clientX: 950, clientY: 1022, pointerId: 1 });
    fireEvent.pointerUp(overlay, { clientX: 950, clientY: 1022, pointerId: 1 });
    await waitFor(() => expect(within(dialog).getAllByTestId("region-box")).toHaveLength(1));
    expect(within(dialog).getByText("Entry 1")).toBeTruthy();
    const page = (await library.pages.listPages((await library.copies.listCurrent())[0].id))[0];
    const drawn = (await library.pages.listRegions(page.id)).find((r) => r.kind === "block");
    expect(drawn.box).toEqual({ x0: 0.08, y0: 0.13, x1: 0.95, y1: 0.73 });

    fireEvent.click(await within(dialog).findByRole("button", { name: "New record…" }));
    const form = within(dialog).getByTestId("manual-record-form");
    expect(within(form).getByText(/New record on Entry 1/)).toBeTruthy();
    fireEvent.change(within(form).getByLabelText("Date as written"), { target: { value: "la douădieci și șase ale lunii Martie" } });
    fireEvent.change(within(form).getByLabelText("Day"), { target: { value: "26" } });
    fireEvent.change(within(form).getByLabelText("Month"), { target: { value: "3" } });
    fireEvent.change(within(form).getByLabelText("Year"), { target: { value: "1866" } });
    fireEvent.change(within(form).getByLabelText("Event place"), { target: { value: "Craiova" } });
    fireEvent.change(within(form).getByLabelText("Name as written 1"), { target: { value: "Șfatu Loti" } });
    fireEvent.change(within(form).getByLabelText("Age 1"), { target: { value: "62" } });
    fireEvent.change(within(form).getByLabelText("Name as written 2"), { target: { value: "Alecsandru Drăgoiescu" } });
    fireEvent.change(within(form).getByLabelText("Occupation 2"), { target: { value: "profesoru" } });
    // the relation is suggested from the roles, but only saved when ticked
    const rel = within(form).getByLabelText(/Alecsandru Drăgoiescu — informant for — Șfatu Loti/);
    fireEvent.click(rel);
    fireEvent.change(within(form).getByLabelText(/Words for Alecsandru Drăgoiescu/), { target: { value: "nepotu mortei" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save record" }));

    await waitFor(() => expect(within(dialog).getByTestId("records-status").textContent).toMatch(/Saved: death record with 2 people and \d+ confirmed values/));
    const card = within(dialog).getByTestId("record-card");
    expect(card.textContent).toMatch(/death · 1866-03-26 \(julian\)/);
    expect(card.textContent).toMatch(/informant for.*Șfatu Loti \(“nepotu mortei”\)/);
    expect(within(card).getAllByTestId("assertion-row").every((r) => /confirmed · you/.test(r.textContent))).toBe(true);
  });

  it("shows the validation error and saves nothing when the date is impossible", async () => {
    const dialog = await openWorkspace();
    fireEvent.click(await within(dialog).findByRole("button", { name: "New record…" }));
    const form = within(dialog).getByTestId("manual-record-form");
    expect(within(form).getByText(/New record on the whole page/)).toBeTruthy();
    fireEvent.change(within(form).getByLabelText("Name as written 1"), { target: { value: "Ion" } });
    fireEvent.change(within(form).getByLabelText("Day"), { target: { value: "30" } });
    fireEvent.change(within(form).getByLabelText("Month"), { target: { value: "2" } });
    fireEvent.change(within(form).getByLabelText("Year"), { target: { value: "1866" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save record" }));
    await waitFor(() => expect(within(form).getByRole("alert").textContent).toMatch(/Not saved: .*day out of range/));
    expect(await library.records.recordsByKind("death")).toEqual([]);
  });
});

describe("the workspace inside the Evidence page", () => {
  it("replaces the document list and returns with ← Documents", async () => {
    render(<DocumentsSection storage={storage} library={library} services={services()} inlineWorkspace />);
    const input = screen.getByTestId("doc-files");
    Object.defineProperty(input, "files", { value: [fakeFile("pag32.png", fixtureBytes("scan.png"))], configurable: true });
    fireEvent.change(input);
    await status(/Added: 1 new/);
    fireEvent.click(screen.getByRole("button", { name: "Read pag32.png" }));
    await status(/^Read 1 pages\.$/);
    fireEvent.click(screen.getByRole("button", { name: "Review text of pag32.png" }));
    const ws = await screen.findByTestId("text-review");
    expect(ws.getAttribute("role")).toBe("region");                                // not a modal dialog
    expect(screen.queryByTestId("copy-list")).toBeNull();
    expect(within(ws).getByRole("button", { name: "Close" }).textContent).toBe("← Documents");
    fireEvent.click(within(ws).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.getByTestId("copy-list")).toBeTruthy());
  });
});
