import { describe, it, expect, afterEach, beforeEach } from "vitest";
import React, { useState } from "react";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { useContextLanes } from "../hooks/useContextLanes.js";
import { createProject } from "../models/project.js";

afterEach(() => { cleanup(); window.history.pushState({}, "", "/"); });

/** A stand-in Wikidata client (the same methods as src/context/wikidata.js). */
function fakeWikidata() {
  const calls = [];
  const log = (name, ...a) => calls.push([name, ...a]);
  return {
    calls,
    searchPlace: async (t) => { log("search", t); return t === "Cluj" ? [{ qid: "Q100188", label: "Cluj-Napoca", description: "municipiu", country: "România", settlement: true }] : []; },
    placeHistory: async (q) => { log("history", q); return { states: [{ qid: "Q28513", label: "Austria-Hungary", from: 1867, to: 1918 }, { qid: "Q203493", label: "Kingdom of Romania", from: 1918, to: 1947 }], county: "Cluj County" }; },
    placeEvents: async (q, f, t) => { log("place", q, f, t); return [{ id: "wd:Q1", label: "Cluj bombing", year: 1944, source: "wikidata" }]; },
    stateEvents: async (q, f, t) => { log("state", q, f, t); return q === "Q28513" ? [{ id: "wd:Q2", label: "Hungarian law", year: 1890, source: "wikidata" }] : [{ id: "wd:Q3", label: "Great Union (wd)", year: 1918, source: "wikidata" }]; },
    globalEvents: async (f, t) => { log("global", f, t); return [{ id: "wd:Q4", label: "First World War", year: 1914, end: 1918, source: "wikidata" }]; },
    placePeople: async (q, f, t) => { log("people", q, f, t); return [{ id: "wdp:Q9", name: "Emil Racoviță", born: 1868, died: 1947, how: ["died"], links: 40, kind: "person", source: "wikidata" }]; },
    refresh: async () => { log("refresh"); },
  };
}

function Harness({ initial, wikidata }) {
  const [project, setProject] = useState(initial);
  const ctx = useContextLanes({ project, people: project.people, storage: null, updateProject: (fn) => setProject((p) => fn(p)), wikidata, debounceMs: 0 });
  return (
    <div>
      <button onClick={() => setProject((p) => ({ ...p, settings: { ...p.settings, ctxNotablePeople: !p.settings.ctxNotablePeople } }))}>people</button>
      <button onClick={() => ctx.refresh()}>refresh</button>
      {ctx.lanes.map((l) => <div key={l.id} data-testid={`lane-${l.id}`}>{l.chips.map((c) => `[${c.label}]`).join("")} {l.items.map((i) => `${i.kind === "person" ? "*" : ""}${i.label}@${i.opacity}`).join("|")}</div>)}
      <output data-testid="resolved">{JSON.stringify(project.settings.contextPlaces ?? {})}</output>
      <output data-testid="loading">{String(ctx.loading)}</output>
    </div>
  );
}

describe("Context lanes looked up from the board (B3)", () => {
  it("a person born in Cluj: the place is found, its history and events fetched, countries at the time", async () => {
    const wd = fakeWikidata();
    const initial = { ...createProject("T"), people: [{ id: "a", name: "Ana Pop", birth: { year: 1880, place: "Cluj" }, death: { year: 1950 } }] };
    render(<Harness initial={initial} wikidata={wd} />);
    await waitFor(() => expect(screen.getByTestId("lane-local").textContent).toMatch(/\[Cluj-Napoca\].*Cluj bombing@1/));
    expect(JSON.parse(screen.getByTestId("resolved").textContent)).toMatchObject({ cluj: { qid: "Q100188", auto: true } });
    await waitFor(() => expect(screen.getByTestId("lane-national").textContent).toMatch(/\[Austria-Hungary\]\[Romania\].*Hungarian law@1/));
    expect(screen.getByTestId("lane-global").textContent).toMatch(/First World War@1/);
    expect(screen.getByTestId("lane-local").textContent).not.toMatch(/Săhăteni/);
    expect(wd.calls.map((c) => c[0])).toEqual(["search", "history", "place", "global", "state", "state"]);
    // nothing new: no more calls
    await new Promise((r) => setTimeout(r, 30));
    expect(wd.calls).toHaveLength(6);
  });

  it("a failing lookup does not stop the others; answers show as they come; the failure is retried next time", async () => {
    const wd = fakeWikidata();
    let failState = true;
    const stateEvents = wd.stateEvents;
    wd.stateEvents = async (q, f, t) => { if (q === "Q28513" && failState) { wd.calls.push(["state-fail", q]); throw new Error("Wikidata answered 502"); } return stateEvents(q, f, t); };
    const initial = { ...createProject("T"), people: [{ id: "a", name: "Ana Pop", birth: { year: 1880, place: "Cluj" }, death: { year: 1950 } }] };
    const { rerender } = render(<Harness initial={initial} wikidata={wd} />);
    await waitFor(() => expect(screen.getByTestId("lane-national").textContent).toMatch(/Great Union \(wd\)@1/));
    expect(screen.getByTestId("lane-local").textContent).toMatch(/Cluj bombing@1/);              // kept despite the failure
    expect(screen.getByTestId("lane-national").textContent).not.toMatch(/Hungarian law/);
    expect(screen.getByTestId("loading").textContent).toBe("false");
    expect(wd.calls.filter((c) => c[0] === "state-fail")).toHaveLength(1);
    void rerender;
  });

  it("notable people only while switched on; Refresh history looks everything up again and keeps the place matches", async () => {
    const wd = fakeWikidata();
    const initial = { ...createProject("T"), people: [{ id: "a", name: "Ana Pop", birth: { year: 1880, place: "Cluj" }, death: { year: 1950 } }] };
    render(<Harness initial={initial} wikidata={wd} />);
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    await waitFor(() => expect(screen.getByTestId("lane-national").textContent).toMatch(/Hungarian law/));
    expect(wd.calls.some((c) => c[0] === "people")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "people" }));
    await waitFor(() => expect(screen.getByTestId("lane-local").textContent).toMatch(/\*Emil Racoviță \(1868–1947\)@1/));
    expect(wd.calls.filter((c) => c[0] === "people")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "people" }));                  // off: hidden, no new calls
    await waitFor(() => expect(screen.getByTestId("lane-local").textContent).not.toMatch(/Racoviță/));
    const before = wd.calls.length;
    const resolvedBefore = screen.getByTestId("resolved").textContent;
    fireEvent.click(screen.getByRole("button", { name: "refresh" }));
    await waitFor(() => expect(wd.calls.slice(before).map((c) => c[0])).toEqual(["refresh", "history", "place", "global", "state", "state"]));
    expect(screen.getByTestId("resolved").textContent).toBe(resolvedBefore);          // your place matches kept
    expect(wd.calls.slice(before).some((c) => c[0] === "search")).toBe(false);
  });

  it("Built-in only makes no calls", async () => {
    const wd = fakeWikidata();
    const initial = { ...createProject("T", { settings: { ctxSource: "builtin" } }), people: [{ id: "a", name: "Ion", birth: { year: 1850, place: "Ploiești" }, death: { year: 1920 } }] };
    render(<Harness initial={initial} wikidata={wd} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(wd.calls).toEqual([]);
    expect(screen.getByTestId("lane-local").textContent).toMatch(/\[Ploiești\].*Railway reaches Ploiești/);
  });
});

describe("Context lanes on the timeline (B3)", () => {
  beforeEach(() => {
    global.indexedDB = new IDBFactory();
    global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  });

  it("the sample board shows its places as chips; a chip fades its events; the source switch; the Places panel", async () => {
    const { default: App } = await import("../App.jsx");
    render(<App />);
    const chips = await screen.findByTestId("ctx-chips-local");
    expect(within(chips).getAllByRole("button").map((b) => b.textContent)).toEqual(expect.arrayContaining(["Săhăteni", "Ploiești"]));
    const ploiesti = within(chips).getByRole("button", { name: "Ploiești" });
    expect(ploiesti.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(ploiesti);
    await waitFor(() => expect(within(screen.getByTestId("ctx-chips-local")).getByRole("button", { name: "Ploiești" }).getAttribute("aria-pressed")).toBe("false"));
    expect(within(screen.getByTestId("ctx-chips-national")).getByRole("button", { name: "Romania" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Context source"), { target: { value: "builtin" } });
    await waitFor(() => expect(screen.getByLabelText("Context source").value).toBe("builtin"));
    fireEvent.click(screen.getByRole("button", { name: "Places" }));
    const panel = await screen.findByTestId("places-panel");
    expect(within(panel).getAllByTestId("place-row").length).toBeGreaterThanOrEqual(2);
    expect(panel.textContent).toMatch(/Built-in only: nothing is looked up/);
  });
});
