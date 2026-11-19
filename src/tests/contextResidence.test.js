import { describe, it, expect } from "vitest";
import { placeSpans, placesOfBoard, placeKey } from "../context/residence.js";
import { createEvent, createPeriod } from "../models/project.js";
import { exportGedcom, parseGedcom } from "../gedcom.js";

describe("Where a person lived (context lanes B1)", () => {
  it("born in Ploiești, a student in București 1870–1874, back in Ploiești: three spans", () => {
    const p = { id: "a", birth: { year: 1850, place: "Ploiești" }, death: { year: 1920, place: "Ploiești" },
      periods: [createPeriod({ start: 1870, end: 1874, label: "Student", place: "București" })], events: [], groups: [] };
    expect(placeSpans(p).map((s) => [s.place, s.from, s.to])).toEqual([["Ploiești", 1850, 1870], ["București", 1870, 1874], ["Ploiești", 1874, 1920]]);
  });

  it("an event with a place moves the person; the death place is a point; no places, no spans", () => {
    const p = { id: "b", birth: { year: 1880, place: "Cluj" }, death: { year: 1950, place: "Sibiu" }, events: [createEvent({ year: 1905, label: "Moves", place: "Brașov" })], periods: [], groups: [] };
    expect(placeSpans(p).map((s) => [s.place, s.from, s.to])).toEqual([["Cluj", 1880, 1905], ["Brașov", 1905, 1950], ["Sibiu", 1950, 1950]]);
    expect(placeSpans({ id: "c", birth: { year: 1900 } })).toEqual([]);
    expect(placeSpans({ id: "d", birth: { year: 1900, place: "Iași" } }, { thisYear: 2026 })).toEqual([{ place: "Iași", key: "iasi", from: 1900, to: 2000 }]);
  });

  it("places of the board: spellings group, each person's spans kept", () => {
    expect(placeKey("Ploiești, Prahova")).toBe(placeKey("PLOIESTI"));
    const m = placesOfBoard([
      { id: "a", birth: { year: 1850, place: "Ploiești" }, death: { year: 1900 } },
      { id: "b", birth: { year: 1870, place: "Ploiesti, Prahova" }, death: { year: 1930 } },
      { id: "c", birth: { year: 1880, place: "București" }, death: { year: 1940 } },
    ]);
    expect([...m.keys()]).toEqual(["ploiesti", "bucuresti"]);
    expect(m.get("ploiesti").spans).toEqual([{ personId: "a", from: 1850, to: 1900 }, { personId: "b", from: 1870, to: 1930 }]);
  });

  it("GEDCOM keeps the places of events and roles", () => {
    const p = { id: "i1", name: "Ion Popa", sex: "M", birth: {}, death: {}, spouseIds: [], groups: [],
      events: [createEvent({ year: 1890, label: "Moves", type: "residence", place: "Brașov", verified: true })],
      periods: [createPeriod({ start: 1870, end: 1874, label: "Student", place: "București", verified: true })] };
    const ged = exportGedcom([p]);
    expect(ged).toMatch(/1 OCCU Student\n2 DATE FROM 1870 TO 1874\n2 PLAC București/);
    expect(ged).toMatch(/2 DATE 1890\n2 PLAC Brașov/);
    const back = parseGedcom(ged).people[0];
    expect(back.periods[0].place).toBe("București");
    expect(back.events[0].place).toBe("Brașov");
  });
});

describe("Place in the item editor", () => {
  it("events, roles and groups have a Place field that is saved", async () => {
    const React = (await import("react")).default;
    const { render, screen, fireEvent, cleanup } = await import("@testing-library/react");
    const { ItemModal } = await import("../components/ItemModal.jsx");
    const onSave = (await import("vitest")).vi.fn();
    const descriptor = { mode: "edit", kind: "period", laneKey: "p:i1", laneId: "i1", laneIsPerson: true, item: { id: "r1", start: 1870, end: 1874, label: "Student" } };
    render(React.createElement(ItemModal, { descriptor, onSave, onDelete: () => {}, onClose: () => {} }));
    fireEvent.change(screen.getByLabelText("Place"), { target: { value: "București " } });
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    expect(onSave.mock.calls[0][0].values).toMatchObject({ label: "Student", place: "București", start: 1870, end: 1874 });
    cleanup();
  });
});
