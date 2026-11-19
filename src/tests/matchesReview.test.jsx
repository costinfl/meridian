import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import React, { useState } from "react";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { resolveFixture } from "./resolveHelpers.js";
import { runMatching } from "../workers/resolveClient.js";
import { personaProfiles, personDraft } from "../resolve/profiles.js";
import {
  waitingMatches, openGroups, acceptMatch, rejectMatch, linkMatchTo, createPersonFromPersonas, linkGroupTo,
  dismissGroup, removeFromGroup, variantSuggestions,
} from "../conclusions/matching.js";
import { currentLinks, linksOfPersona } from "../conclusions/personaLinks.js";
import { createProject } from "../models/project.js";
import MatchesSection from "../components/evidence/MatchesSection.jsx";

afterEach(() => cleanup());
beforeEach(() => { globalThis.URL.createObjectURL = vi.fn(() => "blob:x"); globalThis.URL.revokeObjectURL = vi.fn(); });

async function setup({ variants = true } = {}) {
  const fx = await resolveFixture();
  if (variants) await fx.library.nameVariants.add({ canonical: "Ion", variant: "Ioan" });
  const project = { ...createProject("T"), people: fx.people, families: fx.families };
  const key = Object.fromEntries(Object.entries(fx.personas).map(([k, p]) => [p.id, k]));
  return { fx, project, key, id: (k) => fx.personas[k].id };
}
const statusOf = (p, personaId) => linksOfPersona(p, personaId).map((l) => `${l.personId}:${l.status}`).sort();

describe("Matches review logic (P9.T4)", () => {
  it("accept, reject, link to someone else, create a person, group to a person, dismiss; variant suggestions", async () => {
    const { fx, project, key, id } = await setup();
    let p = (await runMatching({ library: fx.library, project })).apply(project).project;
    const waiting = () => waitingMatches(currentLinks(p));
    const linkOf = (k) => waiting().find((l) => key[l.personaId] === k);

    // accept
    p = acceptMatch(p, linkOf("m1875.groom").id, { decidedBy: "me" }).project;
    expect(statusOf(p, id("m1875.groom"))).toEqual(["t3:accepted"]);
    expect(() => acceptMatch(p, linkOf("m1875.bride").id, {})).toThrow(/decidedBy/);
    // reject: never again
    p = rejectMatch(p, linkOf("d1890.informant").id, { decidedBy: "me" }).project;
    expect(statusOf(p, id("d1890.informant"))).toEqual(["t3:rejected"]);
    const again = await runMatching({ library: fx.library, project: p, full: true });
    expect(again.result.proposals.some((x) => x.personaId === id("d1890.informant") && x.personId === "t3")).toBe(false);
    // link to someone else: the proposal is rejected, the chosen person accepted
    p = linkMatchTo(p, linkOf("b1852.child").id, "t3", { decidedBy: "me" }).project;
    expect(statusOf(p, id("b1852.child"))).toEqual(["t3:accepted", "t6:rejected"]);
    // create a new person from a proposal's persona: the proposal is rejected, the new person accepted
    const before = p.people.length;
    const draft = personDraft([personaProfiles(await fx.library.searchIndex.snapshot()).get(id("d1890.deceased"))]);
    expect(draft).toMatchObject({ name: "Dumitru Hariton", deathYear: 1890 });
    expect(draft.birthYear).toBeGreaterThanOrEqual(1819);
    const created = createPersonFromPersonas(p, [id("d1890.deceased")], draft, { decidedBy: "me" });
    p = created.project;
    expect(p.people).toHaveLength(before + 1);
    expect(created.person).toMatchObject({ name: "Dumitru Hariton", birth: { year: draft.birthYear }, death: { year: 1890 } });
    expect(statusOf(p, id("d1890.deceased"))).toEqual([`${created.person.id}:accepted`, "t1:rejected"]);

    // the group (Ana Popescu twice): link all to a person
    const g = openGroups(p)[0];
    expect(g.personaIds.map((x) => key[x]).sort()).toEqual(["b1850.godparent", "m1875.witness"]);
    const q = linkGroupTo(p, g.id, "t6", { decidedBy: "me" }).project;
    expect(openGroups(q)).toEqual([]);
    expect(g.personaIds.map((x) => statusOf(q, x))).toEqual([["t6:accepted"], ["t6:accepted"]]);
    // or: one is not the same -> the group closes (only one left) and the pair is remembered
    const r = removeFromGroup(p, g.id, g.personaIds[0], { decidedBy: "me" }).project;
    expect(openGroups(r)).toEqual([]);
    expect(r.matchDismissed).toHaveLength(1);
    // or: dismissed altogether
    const d = dismissGroup(p, g.id, { decidedBy: "me" }).project;
    expect((await runMatching({ library: fx.library, project: d, full: true })).result.groups).toEqual([]);
    // or: a new person from the group
    const profs = personaProfiles(await fx.library.searchIndex.snapshot());
    const n = createPersonFromPersonas(p, g.personaIds, personDraft(g.personaIds.map((x) => profs.get(x))), { decidedBy: "me", groupId: g.id });
    expect(n.person.name).toBe("Ana Popescu");
    expect(n.person.birth.year).toBeGreaterThanOrEqual(1825);                          // from the witness's stated age (48 in 1875)
    expect(openGroups(n.project)).toEqual([]);

    // variant suggestions: only different spellings not already paired
    expect(variantSuggestions("Iohannes Hariton", "Ion Hariton", [])).toEqual([{ canonical: "Ion", variant: "Iohannes" }]);
    expect(variantSuggestions("Ioan Haritonu", "Ion Hariton", [{ canonical: "Ion", variant: "Ioan" }])).toEqual([{ canonical: "Hariton", variant: "Haritonu" }]);
    expect(variantSuggestions("Ion Hariton", "Ion Hariton", [])).toEqual([]);
    expect(variantSuggestions("Elena Băltăceanu", "Elena Hariton (b. Băltăceanu)", [])).toEqual([]);        // her maiden name
    expect(variantSuggestions("Elena Hariton", "Elena Băltăceanu", [])).toEqual([]);                          // another surname, not a spelling
    expect(variantSuggestions("Elena Baltaceanul", "Elena Hariton (b. Băltăceanu)", [])).toEqual([{ canonical: "Băltăceanu", variant: "Baltaceanul" }]);
  });
});

function Harness({ library, initial, onOpen }) {
  const [project, setProject] = useState(initial);
  return <MatchesSection library={library} project={project} onOpen={onOpen} onProjectChange={(fn) => setProject((p) => fn(p))} />;
}

describe("Matches section (P9.T4)", () => {
  it("finds matches, shows them side by side with signals, accepts, rejects, suggests a variant, creates a person from a group", async () => {
    const { fx, project } = await setup();
    const onOpen = vi.fn();
    render(<Harness library={fx.library} initial={project} onOpen={onOpen} />);
    expect(screen.getByTestId("matches-status").textContent).toBe("Not run yet.");
    await waitFor(() => expect(screen.getByRole("button", { name: "Find matches" }).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Find matches" }));
    await waitFor(() => expect(screen.getAllByTestId("match-candidate")).toHaveLength(11));
    await waitFor(() => expect(screen.getByTestId("matches-status").textContent).toMatch(/^Compared \d+ pairs · 11 proposed · 1 group/));
    const top = screen.getAllByTestId("match-candidate")[0];
    expect(within(top).getByTestId("match-signals").textContent).toMatch(/given name 1\.00 · surname 1\.00/);

    // accept the 1877 father "Iohannes Hariton" -> Ion Hariton: a variant is suggested
    const iohannes = screen.getAllByTestId("match-candidate").find((c) => /“Iohannes Hariton”/.test(c.textContent));
    expect(iohannes.textContent).toMatch(/Ion Hariton/);
    fireEvent.click(within(iohannes).getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(screen.getAllByTestId("match-candidate")).toHaveLength(10));
    const sugg = await screen.findByTestId("variant-suggestions");
    fireEvent.click(within(sugg).getByRole("button", { name: "Add name variant Ion – Iohannes" }));
    await waitFor(() => expect(screen.queryByTestId("variant-suggestions")).toBeNull());
    expect((await fx.library.nameVariants.list()).some((v) => v.variant === "Iohannes" && v.origin === "learned")).toBe(true);

    // reject one, filter by score
    const one = screen.getAllByTestId("match-candidate")[0];
    fireEvent.click(within(one).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(screen.getAllByTestId("match-candidate")).toHaveLength(9));
    fireEvent.change(screen.getByLabelText("Filter by score"), { target: { value: "0.7" } });
    expect(screen.queryAllByTestId("match-candidate").every((c) => /0\.7\d →/.test(c.textContent))).toBe(true);
    fireEvent.change(screen.getByLabelText("Filter by score"), { target: { value: "" } });

    // the group: create a new person
    const group = screen.getByTestId("match-group");
    expect(group.textContent).toMatch(/2 records/);
    fireEvent.click(within(group).getByRole("button", { name: "Create new person from these" }));
    await waitFor(() => expect(screen.queryByTestId("match-group")).toBeNull());
    expect(screen.getByTestId("matches-status").textContent).toMatch(/New person created: Ana Popescu/);

    // open a page from a candidate
    fireEvent.click(within(screen.getAllByTestId("match-candidate")[0]).getByRole("button", { name: "Open page" }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ pageId: expect.any(String) }));

    // a second run proposes nothing new
    fireEvent.click(screen.getByRole("button", { name: "Find matches" }));
    await waitFor(() => expect(screen.getByTestId("matches-status").textContent).toMatch(/· 0 proposed/));
  });
});
