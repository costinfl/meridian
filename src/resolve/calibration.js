// Calibration (P9.T5): how good were the proposals, judged by your decisions. From every matching proposal you
// accepted or rejected: the acceptance rate per score band, and per signal the mean value in accepted and in rejected
// proposals. With enough decisions, suggested weights (signals that separate accepted from rejected weigh more) and a
// threshold; they are only a suggestion, used when you choose to.
import { DEFAULT_WEIGHTS, DEFAULT_THRESHOLD } from "./score.js";

export const MIN_DECISIONS = 20;
export const BANDS = [[0.9, 1.0001, "0.90–1.00"], [0.8, 0.9, "0.80–0.90"], [0.7, 0.8, "0.70–0.80"], [0, 0.7, "below 0.70"]];
const round = (x, d = 3) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * @param {Array} links  current links of the project (decided matching proposals keep method, score and signals)
 * @returns {{ decisions, accepted, rejected, bands: [{ label, n, accepted, rate }], signals: [{ signal, accepted, rejected, nAccepted, nRejected, separation }], suggestion: { weights, threshold } | null }}
 */
export function calibrationReport(links, { method = "entity-resolution", weights = DEFAULT_WEIGHTS } = {}) {
  const decided = links.filter((l) => l.method === method && (l.status === "accepted" || l.status === "rejected") && typeof l.score === "number");
  const acc = decided.filter((l) => l.status === "accepted"), rej = decided.filter((l) => l.status === "rejected");
  const bands = BANDS.map(([lo, hi, label]) => {
    const inBand = decided.filter((l) => l.score >= lo && l.score < hi);
    const a = inBand.filter((l) => l.status === "accepted").length;
    return { label, n: inBand.length, accepted: a, rate: inBand.length ? round(a / inBand.length, 2) : null };
  }).filter((b) => b.label !== "below 0.70" || b.n);
  const signals = Object.keys(weights).map((k) => {
    const va = acc.map((l) => l.signals?.[k]).filter((v) => typeof v === "number");
    const vr = rej.map((l) => l.signals?.[k]).filter((v) => typeof v === "number");
    const ma = mean(va), mr = mean(vr);
    return { signal: k, accepted: round(ma), rejected: round(mr), nAccepted: va.length, nRejected: vr.length, separation: ma != null && mr != null ? round(ma - mr) : null };
  });

  let suggestion = null;
  if (decided.length >= MIN_DECISIONS && acc.length && rej.length) {
    // weights: in proportion to how well each signal separates accepted from rejected (a small floor keeps every signal)
    const raw = Object.fromEntries(signals.map((s) => [s.signal, s.separation == null || s.nAccepted < 3 || s.nRejected < 3 ? weights[s.signal] : Math.max(0.02, s.separation)]));
    const total = Object.values(raw).reduce((a, b) => a + b, 0);
    const w = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, round(v / total)]));
    // threshold: the lowest of 0.70, 0.75 … 0.95 at which at least 80% of the proposals above it were accepted
    let threshold = DEFAULT_THRESHOLD;
    for (const t of [0.7, 0.75, 0.8, 0.85, 0.9, 0.95]) {
      const above = decided.filter((l) => l.score >= t);
      if (above.length && above.filter((l) => l.status === "accepted").length / above.length >= 0.8) { threshold = t; break; }
    }
    suggestion = { weights: w, threshold };
  }
  return { decisions: decided.length, accepted: acc.length, rejected: rej.length, bands, signals, suggestion };
}
