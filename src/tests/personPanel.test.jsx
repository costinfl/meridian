import { describe, it, expect, afterEach, vi } from "vitest";
import React, { useState } from "react";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { createProject, normalizeProject } from "../models/project.js";
import { createPerson, setParent, addSpouse, removeSpouse, addChild, wouldLoop, familyOf, updatePersonBasics } from "../models/personEdit.js";
import { exportGedcom } from "../gedcom.js";
import { kinshipLabel } from "../graph/kinship.js";
import PersonPanel from "../components/PersonPanel.jsx";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const base = () => normalizeProject({ ...createProject("T"), people: [
  { id: "a", name: "Ion Hariton", sex: "M", birth: { year: 1850 } }, { id: "b", name: "Elena Băltăceanu", sex: "F", birth: { year: 1856 } },
  { id: "c", name: "Gheorghe Hariton", sex: "M", birth: { year: 1878 } }, { id: "d", name: "Dumitru Hariton", sex: "M", birth: { year: 1818 } },
], families: [] });
const byId = (p) => Object.fromEntries(p.people.map((x) => [x.id, x]));

describe("Editing parents and spouses (Phase 9 review, d)", () => {
  it("set and replace parents, spouses, children; families stay the source of truth; labels and GEDCOM follow", () => {
    let p = base();
    p = setParent(p, "c", "father", "a");
    p = setParent(p, "c", "mother", "b");
    expect(byId(p).c).toMatchObject({ fatherId: "a", motherId: "b" });
    expect(p.families).toHaveLength(1);
    p = addSpouse(p, "a", "b");
    expect(byId(p).a.spouseIds).toEqual(["b"]);
    expect(p.families).toHaveLength(1);                                       // the parents' family is the couple
    p = addChild(p, "d", "a");                                                // Dumitru becomes Ion's father
    expect(byId(p).a.fatherId).toBe("d");
    expect(kinshipLabel(byId(p), byId(p).c, byId(p).d)).toBe("grandparent");
    expect(exportGedcom(p.people)).toMatch(/1 HUSB @A@\n1 WIFE @B@\n1 CHIL @C@/);
    // replace the mother; remove a spouse
    const n = createPerson(p, { name: "Maria Văleanu", sex: "F" });
    p = setParent(n.project, "c", "mother", n.person.id);
    expect(byId(p).c).toMatchObject({ fatherId: "a", motherId: n.person.id });
    p = removeSpouse(p, "a", "b");
    expect(byId(p).a.spouseIds ?? []).not.toContain("b");
    // survives normalisation (families are kept, people derived)
    expect(byId(normalizeProject(p)).c).toMatchObject({ fatherId: "a", motherId: n.person.id });
    expect(familyOf(p, "a").children.map((x) => x.id)).toEqual(["c"]);
    expect(updatePersonBasics(p, "a", { name: "Ioan Hariton", sex: "M" }).people.find((x) => x.id === "a").name).toBe("Ioan Hariton");
  });

  it("no loops: nobody becomes their own ancestor", () => {
    let p = setParent(base(), "c", "father", "a");
    p = setParent(p, "a", "father", "d");
    expect(wouldLoop(p, "d", "c")).toBe(true);
    expect(() => setParent(p, "d", "father", "c")).toThrow(/own ancestor/);
    expect(() => setParent(p, "a", "father", "a")).toThrow(/own ancestor/);
    expect(() => createPerson(p, { name: " " })).toThrow(/name/);
  });

  it("the panel: set a father by picking, add a new spouse by name, remove, guard against a loop", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    function Harness() {
      const [project, setProject] = useState(base());
      const [id, setId] = useState("c");
      return <><PersonPanel key={id} project={project} personId={id} onChange={(fn) => setProject((p) => fn(p))} onOpenPerson={setId} onClose={() => {}} />
        <output data-testid="out">{JSON.stringify(project.people.map((x) => [x.id, x.fatherId ?? null, x.motherId ?? null, x.spouseIds ?? []]))}</output></>;
    }
    render(<Harness />);
    const father = screen.getByTestId("panel-father");
    fireEvent.change(within(father).getByLabelText("Set father"), { target: { value: "a" } });
    fireEvent.click(within(father).getByRole("button", { name: "Set" }));
    expect(screen.getByTestId("panel-father").textContent).toMatch(/Ion Hariton/);
    // open the father, add a new spouse by name
    fireEvent.click(within(screen.getByTestId("panel-father")).getByRole("button", { name: "Ion Hariton" }));
    expect(screen.getByText("Family of Ion Hariton")).toBeTruthy();
    const sp = screen.getByTestId("panel-spouses");
    fireEvent.change(within(sp).getByLabelText("Add spouse"), { target: { value: "__new__" } });
    fireEvent.change(within(sp).getByLabelText("Add spouse: new person's name"), { target: { value: "Ana Popa" } });
    fireEvent.click(within(sp).getByRole("button", { name: "Set" }));
    expect(screen.getByTestId("panel-spouses").textContent).toMatch(/Ana Popa/);
    expect(screen.getByTestId("panel-children").textContent).toMatch(/Gheorghe Hariton/);
    // a loop: Gheorghe as Ion's father
    const f2 = screen.getByTestId("panel-father");
    fireEvent.change(within(f2).getByLabelText("Set father"), { target: { value: "c" } });
    fireEvent.click(within(f2).getByRole("button", { name: "Set" }));
    expect(screen.getByRole("alert").textContent).toMatch(/own ancestor/);
    fireEvent.click(screen.getByRole("button", { name: "Remove spouse Ana Popa" }));
    expect(screen.getByTestId("panel-spouses").textContent).toMatch(/none/);
  });
});
