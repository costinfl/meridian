import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { searchLibrary } from "./searchHelpers.js";
import { createSearchService } from "../search/index.js";
import NameVariants from "../components/evidence/NameVariants.jsx";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Name variants screen (Phase 7 review, c)", () => {
  it("add, list, filter and remove pairs; search follows (the index is rebuilt without a removed pair)", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { library } = await searchLibrary();
    const svc = createSearchService(library);
    const before = (await library.nameVariants.list()).length;
    render(<NameVariants library={library} />);
    await waitFor(() => expect(screen.getAllByTestId("variant-pair").length).toBe(before));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Hariton" } });
    fireEvent.change(screen.getByLabelText("Variant"), { target: { value: "Haritonescu" } });
    fireEvent.click(screen.getByRole("button", { name: "Add pair" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Paired: Hariton – Haritonescu."));
    expect(screen.getAllByTestId("variant-pair")).toHaveLength(before + 1);
    // the same name once folded is refused
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ştefan" } });
    fireEvent.change(screen.getByLabelText("Variant"), { target: { value: "Stefan" } });
    fireEvent.click(screen.getByRole("button", { name: "Add pair" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/same/));
    // search uses the pair
    expect((await svc.query({ q: "Haritonescu" })).hits.length).toBeGreaterThan(0);
    // filter
    fireEvent.change(screen.getByLabelText("Filter pairs"), { target: { value: "haritonesc" } });
    expect(screen.getAllByTestId("variant-pair")).toHaveLength(1);
    // remove: gone from the list, from the store, and from search
    fireEvent.click(within(screen.getByTestId("variant-pair")).getByRole("button", { name: /Remove/ }));
    await waitFor(() => expect(screen.queryAllByTestId("variant-pair")).toHaveLength(0));
    expect((await library.nameVariants.list()).some((p) => p.variant === "Haritonescu")).toBe(false);
    expect(await library.searchIndex.get()).toBeNull();
    expect((await createSearchService(library).query({ q: "Haritonescu" })).hits).toEqual([]);
  });
});
