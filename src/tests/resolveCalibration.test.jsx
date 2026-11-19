import { describe, it, expect, afterEach } from "vitest";
import React, { useState } from "react";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { calibrationReport, MIN_DECISIONS } from "../resolve/calibration.js";
import { DEFAULT_WEIGHTS } from "../resolve/score.js";
import { setMatchingWeights } from "../conclusions/matching.js";
import { matchInputs } from "../workers/resolveClient.js";
import { createProject } from "../models/project.js";
import MatchesSection from "../components/evidence/MatchesSection.jsx";

afterEach(() => cleanup());

// fixture decisions: accepted proposals have matching relatives; rejected ones mostly do not; names do not separate
const decision = (i, status, score, relatives, given = 1) => ({
  id: `l${i}`, personId: `p${i}`, personaId: `x${i}`, method: "entity-resolution", status, score,
  signals: { given, surname: 1, date: 0.9, sex: 1, relatives, place: null, fan: null },
});
function fixtureLinks() {
  const out = [];
  for (let i = 0; i < 14; i++) out.push(decision(i, "accepted", 0.82 + (i % 5) * 0.035, 0.95));
  for (let i = 14; i < 18; i++) out.push(decision(i, "rejected", 0.72 + (i % 3) * 0.02, 0.3));
  for (let i = 18; i < 22; i++) out.push(decision(i, "rejected", 0.86, 0.4));
  out.push({ ...decision(99, "candidate", 0.9, 1) });                                  // waiting: not counted
  out.push({ ...decision(98, "accepted", 0.95, 1), method: "manual" });               // not a matching proposal
  return out;
}

describe("Calibration report (P9.T5)", () => {
  it("acceptance per score band and per signal; suggested weights favour the separating signal; threshold", () => {
    const r = calibrationReport(fixtureLinks());
    expect([r.decisions, r.accepted, r.rejected]).toEqual([22, 14, 8]);
    expect(r.bands.map((b) => [b.label, b.n, b.accepted])).toEqual([["0.90–1.00", 5, 5], ["0.80–0.90", 13, 9], ["0.70–0.80", 4, 0]]);
    expect(r.bands[2].rate).toBe(0);
    const rel = r.signals.find((s) => s.signal === "relatives");
    expect(rel).toMatchObject({ accepted: 0.95, nAccepted: 14, nRejected: 8 });
    expect(rel.rejected).toBeCloseTo(0.35, 2);
    expect(r.signals.find((s) => s.signal === "given").separation).toBe(0);
    expect(r.signals.find((s) => s.signal === "place")).toMatchObject({ accepted: null, separation: null });
    expect(r.suggestion.weights.relatives).toBeGreaterThan(r.suggestion.weights.given);
    expect(Object.values(r.suggestion.weights).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2);
    // from 0.80: 14 of 18 accepted (78%); from 0.85: 11 of 15 (73%); from 0.90: 5 of 5 -> the first at 80% or more
    expect(r.suggestion.threshold).toBe(0.9);
  });

  it("no suggestion before enough decisions, or without both accepts and rejects", () => {
    expect(calibrationReport(fixtureLinks().slice(0, MIN_DECISIONS - 1)).suggestion).toBeNull();
    expect(calibrationReport(fixtureLinks().filter((l) => l.status !== "rejected")).suggestion).toBeNull();
    expect(calibrationReport([]).decisions).toBe(0);
  });

  it("chosen weights are used by later runs; back to the standard ones", () => {
    const p0 = createProject("T");
    const p1 = setMatchingWeights(p0, { weights: { ...DEFAULT_WEIGHTS, relatives: 0.5 }, threshold: 0.8 });
    expect(matchInputs(p1)).toMatchObject({ threshold: 0.8, weights: { relatives: 0.5 } });
    const p2 = setMatchingWeights(p1, null);
    expect(matchInputs(p2).weights).toBeUndefined();
  });

  it("the Matches section shows the report and applies the suggestion only when asked", () => {
    function Harness() {
      const [project, setProject] = useState({ ...createProject("T"), personaLinks: fixtureLinks().map((l) => ({ ...l, supersedesId: null })) });
      return <><MatchesSection library={{ searchIndex: { snapshot: () => new Promise(() => {}) } }} project={project} onProjectChange={(fn) => setProject((p) => fn(p))} /><output data-testid="w">{JSON.stringify(project.settings?.matching ?? null)}</output></>;
    }
    render(<Harness />);
    const cal = screen.getByTestId("calibration");
    expect(cal.textContent).toMatch(/22 decided: 14 accepted, 8 rejected/);
    expect(cal.textContent).toMatch(/0\.70–0\.80\s*40%|0\.70–0\.80\s*4\s*0%/);
    expect(screen.getByTestId("w").textContent).toBe("null");
    fireEvent.click(within(screen.getByTestId("calibration-suggestion")).getByRole("button", { name: "Use these weights" }));
    expect(JSON.parse(screen.getByTestId("w").textContent).threshold).toBe(0.9);
    fireEvent.click(screen.getByRole("button", { name: "Back to the standard weights" }));
    expect(JSON.parse(screen.getByTestId("w").textContent).weights).toBeUndefined();
  });
});
