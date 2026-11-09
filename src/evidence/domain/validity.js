import { invalid } from "./errors.js";
import { OPEN_EARLIEST_DAY, OPEN_LATEST_DAY, fuzzyDateFromIso, parseIsoPartial, toJdn, daysInMonth } from "./fuzzyDate.js";

/*
 * Validity intervals for place names and place hierarchy edges ("valid from / valid to").
 * Bounds are partial ISO dates ("1859", "1859-03", "1859-03-12") or null for open ends.
 * `fromDay` is the first day of validFrom's period, `toDay` the last day of validTo's period
 * (Julian Day Numbers, proleptic Gregorian), so "1859 .. 1918" covers 1859-01-01 .. 1918-12-31.
 */

export function intervalOf(validFrom = null, validTo = null) {
  const fromDay = validFrom == null ? OPEN_EARLIEST_DAY : fuzzyDateFromIso(validFrom).earliestDay;
  const toDay = validTo == null ? OPEN_LATEST_DAY : fuzzyDateFromIso(validTo).latestDay;
  if (fromDay > toDay) throw invalid("validFrom must not be after validTo");
  return { validFrom: validFrom ?? null, validTo: validTo ?? null, fromDay, toDay };
}

/** Day range [from, to] for a point or period in time: ISO string, FuzzyDate, day number or [from, to] days. */
export function dayRangeOf(when) {
  if (typeof when === "number") return [when, when];
  if (typeof when === "string") { const d = fuzzyDateFromIso(when); return [d.earliestDay, d.latestDay]; }
  if (Array.isArray(when) && when.length === 2) return [when[0], when[1]];
  if (when && Number.isInteger(when.earliestDay) && Number.isInteger(when.latestDay)) return [when.earliestDay, when.latestDay];
  throw invalid("'when' must be an ISO date, a FuzzyDate, a day number or [fromDay, toDay]");
}

export const intervalsOverlap = (a, b) => a.fromDay <= b.toDay && b.fromDay <= a.toDay;
export const validDuring = (rec, [from, to]) => rec.fromDay <= to && from <= rec.toDay;

export { parseIsoPartial, toJdn, daysInMonth };
