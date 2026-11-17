import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { memoryDeviceStorage } from "./ingestHelpers.js";
import { freshStorage } from "./evidenceHelpers.js";
import { searchLibrary } from "./searchHelpers.js";
import SearchSection from "../components/evidence/SearchSection.jsx";
import EvidencePage from "../components/evidence/EvidencePage.jsx";

afterEach(() => cleanup());
beforeEach(() => {
  globalThis.URL.createObjectURL = vi.fn(() => "blob:page");
  globalThis.URL.revokeObjectURL = vi.fn();
});

const indexStatus = (re) => waitFor(() => expect(screen.getByTestId("index-status").textContent).toMatch(re), { timeout: 4000 });

describe("Search section (P7.T4)", () => {
  it("indexes on open, finds by name, sound and variant, shows snippets, reasons and status, and opens a hit", async () => {
    const { library, pages } = await searchLibrary();
    await library.pageCache.put({ pageId: pages.p1.page.id, variant: "max2000", bytes: new Uint8Array([1, 2]), mimeType: "image/png", width: 1000, height: 1400 });
    const onOpen = vi.fn();
    render(<SearchSection library={library} project={{ sources: [] }} onOpen={onOpen} />);
    await indexStatus(/^3 regions indexed · updated /);

    fireEvent.change(screen.getByLabelText("Search for"), { target: { value: "Szvet" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const results = await screen.findByTestId("search-results");
    expect(within(results).getByRole("status").textContent).toBe("1 result");
    const hit = within(results).getByTestId("search-hit");
    expect(hit.textContent).toMatch(/Registrul stării civile, Craiova, decese 1866 · page 32 \(32\) · death record/);
    expect(hit.textContent).toMatch(/People: .*Șfatu Loti/);
    expect(hit.textContent).toMatch(/sounds like “szvet”/);
    expect(hit.textContent).toMatch(/proposed values/);

    fireEvent.change(screen.getByLabelText("Search for"), { target: { value: "Stefan" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(within(screen.getByTestId("search-results")).getByTestId("hit-snippet").querySelector("mark").textContent).toBe("Ştefan"));
    expect(await within(screen.getByTestId("search-results")).findByTestId("hit-crop")).toBeTruthy(); // the page image was cached (loads asynchronously)

    fireEvent.change(screen.getByLabelText("Search for"), { target: { value: "Ioan" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(screen.getByTestId("search-results").textContent).toMatch(/variant of “ioan”/));

    fireEvent.click(within(screen.getByTestId("search-results")).getByTestId("search-hit"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ pageId: pages.p1.page.id, regionKind: "page" }));

    // filters
    fireEvent.change(screen.getByLabelText("Search for"), { target: { value: "Loti" } });
    fireEvent.click(screen.getByLabelText(/confirmed only/));
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(within(screen.getByTestId("search-results")).getByRole("status").textContent).toBe("Nothing found."));
    expect(screen.getByLabelText(/only this project's sources/).disabled).toBe(true);       // the project has no library sources
  });

  it("Rebuild index rebuilds; new evidence is picked up when the section opens again", async () => {
    const { library, copies, runs } = await searchLibrary();
    const { unmount } = render(<SearchSection library={library} project={null} />);
    await indexStatus(/^3 regions indexed/);
    fireEvent.click(screen.getByRole("button", { name: "Rebuild index" }));
    await indexStatus(/^3 regions indexed/);
    unmount();
    const p = await library.pages.addPage({ copyId: copies.c1.id, pageIndex: 7, width: 10, height: 10 });
    await library.textLayers.add({ regionId: p.wholePageRegion.id, runId: runs.ocr.id, originalText: "Gheorghe Ionescu" });
    render(<SearchSection library={library} project={null} />);
    await indexStatus(/^4 regions indexed/);
  });

  it("on the Evidence page, Search is the first section and a hit opens the page workspace on its page and box", async () => {
    const { storage, record } = await searchLibrary({ storage: memoryDeviceStorage(freshStorage()) });
    render(<EvidencePage storage={storage} project={null} onClose={() => {}} />);
    const nav = screen.getByRole("navigation", { name: "Evidence sections" });
    expect(within(nav).getAllByRole("button")[0].textContent).toBe("Search");
    await indexStatus(/regions indexed/);
    fireEvent.change(screen.getByLabelText("Search for"), { target: { value: "Cristescu" } });
    fireEvent.click(within(screen.getByTestId("search-section")).getByRole("button", { name: "Search" }));
    fireEvent.click(await screen.findByTestId("search-hit"));
    const ws = await screen.findByTestId("text-review");
    expect(within(ws).getByRole("tab", { name: "Records" }).getAttribute("aria-selected")).toBe("true");
    await waitFor(() => expect(within(ws).getByText(/Working on:/).textContent).toMatch(/death record/));
    expect(record.record.regionIds).toHaveLength(1);
  });
});
