/**
 * Tests for the view re-fit logic that runs on initial mount (App.jsx initRef effect).
 *
 * The effect:
 *   if (trackW > 0 && project && !initRef.current) {
 *     initRef.current = true;
 *     if ((project.settings?.view?.ppy ?? 8) === 8) fitRange(1842, 1996);
 *   }
 *
 * fitRange math:
 *   w   = clientWidth − HEADER_W  (HEADER_W = 216)
 *   ppy = clamp(w / (1996 − 1842), 0.3, 300)
 *       = clamp(w / 154, 0.3, 300)
 */

import { describe, it, expect } from "vitest";
import { clamp } from "../theme.js";

const HEADER_W = 216;
const REFIT_A = 1842;
const REFIT_B = 1996;
const RANGE_SPAN = REFIT_B - REFIT_A; // 154

function computeRefitPpy(clientWidth) {
  const w = clientWidth - HEADER_W;
  if (w <= 0) return null;
  return clamp(w / RANGE_SPAN, 0.3, 300);
}

// The guard that decides whether re-fit should run
function shouldRefit(savedPpy) {
  return (savedPpy ?? 8) === 8;
}

describe("re-fit ppy calculation", () => {
  it("produces ppy >= 4.5 for typical desktop viewport widths", () => {
    // Minimum track for ppy=4.5: 4.5*154=693 → viewport 693+216=909 px
    for (const w of [909, 1024, 1280, 1440, 1920, 2560]) {
      expect(computeRefitPpy(w)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("produces ppy < 4.5 for narrow viewports below the threshold", () => {
    // 900px → track=684 → ppy=684/154≈4.44 < 4.5
    expect(computeRefitPpy(900)).toBeLessThan(4.5);
  });

  it("clamps to 0.3 for viewports barely wider than the header", () => {
    // track = 220-216 = 4px → 4/154≈0.026 → clamped to 0.3
    expect(computeRefitPpy(220)).toBeCloseTo(0.3);
  });

  it("clamps to 300 for absurdly wide viewports", () => {
    expect(computeRefitPpy(100_000)).toBe(300);
  });

  it("returns null when track width is zero or negative", () => {
    expect(computeRefitPpy(216)).toBeNull(); // exactly header width, no track
    expect(computeRefitPpy(100)).toBeNull(); // narrower than header
  });
});

describe("re-fit guard (ppy === 8 check)", () => {
  it("triggers re-fit when ppy is the default (8)", () => {
    expect(shouldRefit(8)).toBe(true);
  });

  it("triggers re-fit when ppy is absent (new project with no saved view)", () => {
    expect(shouldRefit(undefined)).toBe(true);
  });

  it("preserves a user-set ppy (does NOT re-fit)", () => {
    expect(shouldRefit(12)).toBe(false);
    expect(shouldRefit(4.2)).toBe(false);
    expect(shouldRefit(0.5)).toBe(false);
    expect(shouldRefit(300)).toBe(false);
  });

  it("preserves ppy=8 only when it is literally 8 — not a float close to 8", () => {
    // The check is strict equality, so 7.9999 does NOT re-fit
    expect(shouldRefit(7.9999)).toBe(false);
    expect(shouldRefit(8.0001)).toBe(false);
  });
});

describe("re-fit range invariant", () => {
  it("the default re-fit range (1842–1996) spans 154 years", () => {
    expect(RANGE_SPAN).toBe(154);
  });

  it("minimum viewport for ppy >= 4.5 is 909 px", () => {
    // Derived: w >= 4.5 * 154 = 693 → clientWidth >= 693 + 216 = 909
    const minViewport = Math.ceil(4.5 * RANGE_SPAN) + HEADER_W;
    expect(minViewport).toBe(909);
    expect(computeRefitPpy(minViewport - 1)).toBeLessThan(4.5);
    expect(computeRefitPpy(minViewport)).toBeGreaterThanOrEqual(4.5);
  });
});