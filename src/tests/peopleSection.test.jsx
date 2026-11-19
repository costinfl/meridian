import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { graphFixture } from "./graphHelpers.js";
import PeopleSection from "../components/evidence/PeopleSection.jsx";

afterEach(() => cleanup());

const projectOf = (fx, extra = {}) => ({
  people: [
    { id: "i1", name: "Dumitru Hariton", sex: "M", spouseIds: ["i3"] },
    { id: "i2", name: "Ion Hariton", sex: "M", fatherId: "i1", motherId: "i3" },
    { id: "i3", name: "Maria Hariton", sex: "F", spouseIds: ["i1"] },
  ],
  families: fx.families, personaLinks: fx.links, relationships: [], settings: { focusPersonId: "i2" }, ...extra,
});

describe("People section (P8.T5)", () => {
  it("lists records by person, follows accepted links, marks possible ones, filters, switches person, shows kinship, opens a page", async () => {
    const fx = await graphFixture();
    const onOpen = vi.fn();
    render(<PeopleSection library={fx.library} project={projectOf(fx)} onOpen={onOpen} />);

    // the focus person (Ion) is linked to the baptism only as a candidate: shown as possible
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/^1 record \(1 through possible links\)/));
    let card = screen.getByTestId("fan-record");
    expect(card.textContent).toMatch(/baptism · 1850/);
    expect(card.textContent).toMatch(/As child \(“Ion”\) — possible/);
    const others = within(card).getAllByTestId("fan-other").map((li) => li.textContent);
    expect(others.some((t) => /godparent.*Ana Popescu/.test(t))).toBe(true);
    expect(others.some((t) => /father.*Dumitru Hariton.*same house|father.*Dumitru Hariton/.test(t))).toBe(true);
    expect(others.join("|")).not.toMatch(/Maria Hariton$/);        // rejected link (Ana -> Maria) never shown as a person
    expect(screen.queryByTestId("kinship")).toBeNull();               // the focus person itself

    // open the page
    fireEvent.click(within(card).getByRole("button", { name: "Open page" }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ pageId: fx.pages.p2.page.id, copyId: fx.copy.id }));

    // filter: only godparents among the others; years outside
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "godparent" } });
    await waitFor(() => expect(screen.getAllByTestId("fan-record")).toHaveLength(1));
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "witness" } });
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/^No records/));
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("From year"), { target: { value: "1860" } });
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/^No records/));
    fireEvent.change(screen.getByLabelText("From year"), { target: { value: "" } });

    // click the linked father: switch person; kinship to the focus is shown
    card = await screen.findByTestId("fan-record");
    fireEvent.click(within(card).getByRole("button", { name: "Dumitru Hariton" }));
    await waitFor(() => expect(screen.getByLabelText("Person").value).toBe("i1"));
    expect(screen.getByTestId("kinship").textContent).toMatch(/Dumitru Hariton is the father of Ion Hariton/);
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/^1 record$/));
    expect(screen.getByTestId("fan-record").textContent).toMatch(/As father \(“Dumitru Hariton”\)/);
    expect(screen.getByTestId("fan-record").textContent).not.toMatch(/possible: this link/);
  });

  it("two steps show the associates' own records; a new record is picked up on re-render", async () => {
    const fx = await graphFixture();
    const project = projectOf(fx);                                     // focus: Ion
    const { rerender } = render(<PeopleSection library={fx.library} project={{ ...project, settings: { focusPersonId: "i1" } }} />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/^1 record$/));

    // a second record for Dumitru, linked: the section updates incrementally
    const run = await fx.library.runs.startRun({ processor: "manual" });
    const rec = await fx.library.records.createRecord({ kind: "marriage", regionIds: [fx.pages.p1.wholePageRegion.id], runId: run.id, personas: [{ nameAsWritten: "Dumitru", role: "groom" }, { nameAsWritten: "Maria", role: "bride" }] });
    const linked = { ...project, settings: { focusPersonId: "i1" }, personaLinks: [...fx.links, { id: "L9", personId: "i1", personaId: rec.personas[0].id, status: "accepted" }] };
    rerender(<PeopleSection library={fx.library} project={linked} />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/^2 records$/));

    // from Ion, two steps: the baptism names Dumitru (accepted link), whose marriage is one step further
    fireEvent.change(screen.getByLabelText("Person"), { target: { value: "i2" } });
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/^1 record/));
    expect(screen.queryByTestId("fan-second")).toBeNull();
    fireEvent.change(screen.getByLabelText("Steps"), { target: { value: "2" } });
    const second = await screen.findByTestId("fan-second");
    expect(second.textContent).toMatch(/Records of Dumitru Hariton/);
    expect(second.textContent).toMatch(/marriage/);
    expect(second.textContent).not.toMatch(/baptism/);                // a record is shown once

    // from Dumitru, two steps: Ion is linked only as a candidate, so his records are followed and marked possible
    const run2 = await fx.library.runs.startRun({ processor: "manual" });
    const conf = await fx.library.records.createRecord({ kind: "census", regionIds: [fx.pages.p1.wholePageRegion.id], runId: run2.id, personas: [{ nameAsWritten: "Ion Hariton", role: "subject" }] });
    rerender(<PeopleSection library={fx.library} project={{ ...linked, personaLinks: [...linked.personaLinks, { id: "L10", personId: "i2", personaId: conf.personas[0].id, status: "candidate" }] }} />);
    fireEvent.change(screen.getByLabelText("Person"), { target: { value: "i1" } });
    await waitFor(() => expect(screen.getByTestId("fan-second").textContent).toMatch(/Records of possible: Ion Hariton/));
    expect(screen.getByTestId("fan-second").textContent).toMatch(/census/);
  });

  it("says so when the project has no people", () => {
    render(<PeopleSection library={{}} project={{ people: [] }} />);
    expect(screen.getByTestId("people-section").textContent).toMatch(/no people yet/);
  });
});
