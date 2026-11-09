import { describe, it, expect, beforeEach } from "vitest";
import React, { useState } from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { freshStorage } from "./evidenceHelpers.js";
import EvidencePanel from "../components/evidence/EvidencePanel.jsx";
import { createProject, normalizeProject } from "../models/project.js";
import { SAMPLE_PEOPLE } from "../sampleData.js";

const clone = (x) => JSON.parse(JSON.stringify(x));
let storage;
beforeEach(() => { storage = freshStorage(); cleanup(); });

function Host({ initial }) {
  const [project, setProject] = useState(initial);
  return <EvidencePanel storage={storage} project={project} onProjectChange={(fn) => setProject((p) => fn(p))} onClose={() => {}} />;
}

describe("Evidence panel: legacy facts (P4.T3, P4.T4 UI)", () => {
  it("shows the dry-run report, converts on click, then offers the one-time confirmation of verified facts", async () => {
    const project = normalizeProject(createProject("Hariton", { people: clone(SAMPLE_PEOPLE) }));
    render(<Host initial={project} />);
    expect(screen.getByTestId("dry-run").textContent).toMatch(/Would create: 8 records/);
    expect(screen.queryByRole("button", { name: /Confirm .* verified/ })).toBeNull();      // not before converting

    fireEvent.click(screen.getByRole("button", { name: /Convert \d+ legacy items to evidence/ }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Done: \d+ assertions, 8 personas/));
    expect(screen.getByRole("status").textContent).toMatch(/Nothing was confirmed/);
    expect(await storage.dbCount("evAssertions")).toBeGreaterThan(40);
    expect((await storage.dbGetAllByIndex("evAssertionDecisions", "byStatus", "confirmed"))).toEqual([]); // I6

    const confirm = await screen.findByRole("button", { name: "Confirm 5 verified facts" });
    expect(screen.getByRole("button", { name: /Nothing left to convert/ })).toBeDisabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Confirmed 5 verified facts/));
    expect((await storage.dbGetAllByIndex("evAssertionDecisions", "byStatus", "confirmed"))).toHaveLength(5);
    await waitFor(() => expect(screen.queryByRole("button", { name: /Confirm .* verified/ })).toBeNull());
  });

  it("lists anomalies, reports failures instead of crashing, and shows nothing legacy-related without a project", async () => {
    const odd = normalizeProject(createProject("T", { people: [{ id: "a", name: "A", events: [{ id: "e", label: "x", verified: true }], periods: [], groups: [] }] }));
    const { unmount } = render(<Host initial={odd} />);
    expect(screen.getByText(/anomalies noticed/)).toBeTruthy();
    unmount();
    render(<EvidencePanel storage={storage} project={null} onClose={() => {}} />);
    expect(screen.queryByTestId("legacy-section")).toBeNull();
  });
});
