// Scoring (P9.T3): one number per pair from the comparator signals. Weighted mean over the signals that could be
// computed, scaled down when too little was known (a pair matched on the names alone is not a strong candidate),
// and pulled down by a clearly different given name or surname. A veto gives 0.

export const DEFAULT_WEIGHTS = { given: 0.2, surname: 0.15, date: 0.2, relatives: 0.2, place: 0.1, fan: 0.1, sex: 0.05 };
export const DEFAULT_THRESHOLD = 0.8;
export const MAX_CANDIDATES_PER_PERSONA = 3;
const ENOUGH_KNOWN = 0.6;   // weight of the signals that must be known for full confidence
export const CLOSE_DATE = 0.85;         // a date signal this high comes from a stated age or date, not from a role window
export const UNCORROBORATED_CAP = 0.65; // the most a pair can score on names (and a vague date) alone: below the threshold

export function scorePair({ signals, veto }, weights = DEFAULT_WEIGHTS) {
  if (veto) return 0;
  let sum = 0, used = 0;
  for (const [k, w] of Object.entries(weights)) {
    const v = signals[k];
    if (v == null || !w) continue;
    sum += w * v; used += w;
  }
  if (!used) return 0;
  let score = (sum / used) * (0.5 + 0.5 * Math.min(1, used / ENOUGH_KNOWN));
  for (const k of ["given", "surname"]) if (signals[k] != null && signals[k] < 0.75) score *= signals[k];
  // relatives named differently are evidence against
  if (signals.relatives != null && signals.relatives < 0.6) score *= 0.5 + signals.relatives / 1.2;
  // names alone are not enough: a proposal needs something more (a close date, matching relatives, shared associates)
  const relativesAgree = (signals.relativesStrong ?? 0) >= 2 || (signals.relativesLinked ?? 0) >= 1 || (signals.relativesDated ?? 0) >= 1;
  const corroborated = (signals.date ?? 0) >= CLOSE_DATE || relativesAgree || (signals.fan ?? 0) >= 1;
  if (!corroborated) score = Math.min(score, UNCORROBORATED_CAP);
  return Math.round(score * 1000) / 1000;
}
