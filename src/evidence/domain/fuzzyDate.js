import { invalid } from "./errors.js";

/*
 * FuzzyDate: a plain object embedded wherever a date appears (see evidence-model.md).
 *   { asWritten, earliest, latest, earliestDay, latestDay, calendar, precision, derivedFrom }
 * - `earliest` / `latest` are ISO strings (YYYY-MM-DD) in the record's own calendar; null = open end.
 * - `earliestDay` / `latestDay` are Julian Day Numbers (integers), so ranges stay comparable across
 *   Julian and Gregorian records and can be indexed and overlap-tested.
 * - Ranges are inclusive and never narrower than the truth (leap-day cases widen).
 */

export const CALENDARS = ["julian", "gregorian"];
export const PRECISIONS = ["day", "month", "year", "about", "before", "after"];
export const DERIVED_FROM = ["stated", "computed"];
export const OPEN_EARLIEST_DAY = 0;        // JDN 0 (4713 BC): "no lower bound"
export const OPEN_LATEST_DAY = 5373484;    // 9999-12-31 Gregorian: "no upper bound"
export const ABOUT_SPAN_YEARS = 2;         // "about 1850" = 1848-01-01 .. 1852-12-31 (design leaves this open; see PROGRESS log)

/* ---------- calendar arithmetic (Julian Day Numbers) ---------- */

const div = Math.floor;

export function isLeapYear(year, calendar) {
  if (calendar === "julian") return year % 4 === 0;
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year, month, calendar) {
  return [31, isLeapYear(year, calendar) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

function checkCalendar(calendar) {
  if (!CALENDARS.includes(calendar)) throw invalid(`calendar must be one of: ${CALENDARS.join(", ")}`);
}

/** Julian Day Number of a date in the given calendar. Validates the date. */
export function toJdn(year, month, day, calendar = "gregorian") {
  checkCalendar(calendar);
  if (![year, month, day].every(Number.isInteger)) throw invalid("year, month and day must be integers");
  if (month < 1 || month > 12) throw invalid(`month out of range: ${month}`);
  if (day < 1 || day > daysInMonth(year, month, calendar)) throw invalid(`day out of range: ${year}-${month}-${day} (${calendar})`);
  const a = div((14 - month) / 12), y = year + 4800 - a, m = month + 12 * a - 3;
  const base = day + div((153 * m + 2) / 5) + 365 * y + div(y / 4);
  return calendar === "julian" ? base - 32083 : base - div(y / 100) + div(y / 400) - 32045;
}

/** { year, month, day } of a Julian Day Number in the given calendar. */
export function fromJdn(jdn, calendar = "gregorian") {
  checkCalendar(calendar);
  let b = 0, c;
  if (calendar === "julian") c = jdn + 32082;
  else { const a = jdn + 32044; b = div((4 * a + 3) / 146097); c = a - div((146097 * b) / 4); }
  const d = div((4 * c + 3) / 1461), e = c - div((1461 * d) / 4), m = div((5 * e + 2) / 153);
  return { day: e - div((153 * m + 2) / 5) + 1, month: m + 3 - 12 * div(m / 10), year: 100 * b + d - 4800 + div(m / 10) };
}

const jdnOf = (p, calendar) => toJdn(p.year, p.month, p.day, calendar);

export const pad = (n, w) => String(n).padStart(w, "0");
export const isoOf = ({ year, month, day }) => `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;

/** Parse "YYYY", "YYYY-MM" or "YYYY-MM-DD" into parts (missing parts are null). */
export function parseIsoPartial(text) {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(String(text ?? "").trim());
  if (!m) throw invalid(`not an ISO date: ${text}`);
  return { year: +m[1], month: m[2] ? +m[2] : null, day: m[3] ? +m[3] : null };
}

/* ---------- construction ---------- */

function make({ asWritten = "", earliestDay, latestDay, calendar, precision, derivedFrom }) {
  checkCalendar(calendar);
  if (!PRECISIONS.includes(precision)) throw invalid(`precision must be one of: ${PRECISIONS.join(", ")}`);
  if (!DERIVED_FROM.includes(derivedFrom)) throw invalid(`derivedFrom must be one of: ${DERIVED_FROM.join(", ")}`);
  if (earliestDay > latestDay) throw invalid("earliest must not be after latest");
  const iso = (day, open) => (day === open ? null : isoOf(fromJdn(day, calendar)));
  return {
    asWritten,
    earliest: iso(earliestDay, OPEN_EARLIEST_DAY),
    latest: iso(latestDay, OPEN_LATEST_DAY),
    earliestDay, latestDay,
    calendar, precision, derivedFrom,
  };
}

function rangeOf({ year, month = null, day = null }, calendar) {
  if (!Number.isInteger(year)) throw invalid("year is required");
  if (month == null) return { from: toJdn(year, 1, 1, calendar), to: toJdn(year, 12, 31, calendar), precision: "year" };
  if (day == null) return { from: toJdn(year, month, 1, calendar), to: toJdn(year, month, daysInMonth(year, month, calendar), calendar), precision: "month" };
  const d = toJdn(year, month, day, calendar);
  return { from: d, to: d, precision: "day" };
}

/**
 * A stated date. Parts may be partial: { year } -> the whole year, { year, month } -> the whole month.
 * `modifier`: "about" widens by ABOUT_SPAN_YEARS each side; "before" / "after" are open-ended.
 */
export function fuzzyDate({ asWritten = "", year, month = null, day = null, calendar = "gregorian", modifier = null, spanYears = ABOUT_SPAN_YEARS } = {}) {
  const r = rangeOf({ year, month, day }, calendar);
  if (modifier === "about") {
    return make({ asWritten, earliestDay: toJdn(year - spanYears, 1, 1, calendar), latestDay: toJdn(year + spanYears, 12, 31, calendar), calendar, precision: "about", derivedFrom: "stated" });
  }
  if (modifier === "before") return make({ asWritten, earliestDay: OPEN_EARLIEST_DAY, latestDay: r.from - 1, calendar, precision: "before", derivedFrom: "stated" });
  if (modifier === "after") return make({ asWritten, earliestDay: r.to + 1, latestDay: OPEN_LATEST_DAY, calendar, precision: "after", derivedFrom: "stated" });
  if (modifier != null) throw invalid(`unknown modifier: ${modifier}`);
  return make({ asWritten, earliestDay: r.from, latestDay: r.to, calendar, precision: r.precision, derivedFrom: "stated" });
}

/** From an ISO string like "1843-03-12", "1843-03" or "1843". */
export function fuzzyDateFromIso(iso, options = {}) {
  return fuzzyDate({ asWritten: options.asWritten ?? iso, ...parseIsoPartial(iso), calendar: options.calendar, modifier: options.modifier });
}

/* ---------- stated age at an event ---------- */

// Subtract whole years from a date; Feb 29 maps to Feb 28 ("early") or Mar 1 ("late") so ranges only widen.
function minusYears(parts, n, calendar, bias) {
  const year = parts.year - n;
  if (parts.month === 2 && parts.day === 29 && !isLeapYear(year, calendar)) {
    return bias === "late" ? { year, month: 3, day: 1 } : { year, month: 2, day: 28 };
  }
  return { year, month: parts.month, day: parts.day };
}

function minusMonths(parts, n, calendar, bias) {
  let total = parts.year * 12 + (parts.month - 1) - n;
  const year = div(total / 12), month = (total % 12 + 12) % 12 + 1;
  const dim = daysInMonth(year, month, calendar);
  if (parts.day <= dim) return { year, month, day: parts.day };
  return bias === "late" ? (month === 12 ? { year: year + 1, month: 1, day: 1 } : { year, month: month + 1, day: 1 }) : { year, month, day: dim };
}

/**
 * Birth range from a stated age at an event date. "45 ani" at 1885-03-01 -> born 1839-03-02 .. 1840-03-01.
 * @param {{ value: number, unit?: "years"|"months"|"days", slack?: number }} age  slack = extra years each side for "about"
 * @param {object} eventDate  a FuzzyDate (its calendar is used)
 */
export function fromStatedAge(age, eventDate, { asWritten = "" } = {}) {
  const { value, unit = "years", slack = 0 } = age ?? {};
  if (!Number.isInteger(value) || value < 0) throw invalid("age value must be an integer >= 0");
  if (!["years", "months", "days"].includes(unit)) throw invalid("age unit must be years, months or days");
  if (!eventDate || !Number.isInteger(eventDate.earliestDay) || !Number.isInteger(eventDate.latestDay)) throw invalid("an event FuzzyDate is required");
  if (eventDate.earliestDay === OPEN_EARLIEST_DAY || eventDate.latestDay === OPEN_LATEST_DAY) throw invalid("the event date must have both bounds");
  const cal = eventDate.calendar;
  const e1 = fromJdn(eventDate.earliestDay, cal), e2 = fromJdn(eventDate.latestDay, cal);
  let from, to;
  if (unit === "days") {
    from = eventDate.earliestDay - (value + 1) + 1;
    to = eventDate.latestDay - value;
  } else {
    const sub = unit === "years" ? minusYears : minusMonths;
    from = jdnOf(sub(e1, value + 1, cal, "early"), cal) + 1; // day after the date one unit earlier
    to = jdnOf(sub(e2, value, cal, "late"), cal);
  }
  if (slack) {
    const f = fromJdn(from, cal), t = fromJdn(to, cal);
    from = jdnOf(minusYears(f, slack, cal, "early"), cal);
    to = jdnOf(minusYears(t, -slack, cal, "late"), cal);
  }
  return make({
    asWritten, earliestDay: from, latestDay: to, calendar: cal,
    precision: slack ? "about" : unit === "years" ? "year" : unit === "months" ? "month" : "day",
    derivedFrom: "computed",
  });
}

/* ---------- queries ---------- */

/** Inclusive range overlap. */
export function overlaps(a, b) {
  return a.earliestDay <= b.latestDay && b.earliestDay <= a.latestDay;
}

export function containsDay(d, day) {
  return d.earliestDay <= day && day <= d.latestDay;
}

/** Day number of a Gregorian date (convenience for queries). */
export const dayOf = (year, month, day, calendar = "gregorian") => toJdn(year, month, day, calendar);

/** Check a stored value is internally consistent (ISO strings match the day numbers). */
export function validateFuzzyDate(d) {
  if (!d || typeof d !== "object") throw invalid("fuzzy date is required");
  checkCalendar(d.calendar);
  if (!PRECISIONS.includes(d.precision)) throw invalid("bad precision");
  if (!DERIVED_FROM.includes(d.derivedFrom)) throw invalid("bad derivedFrom");
  if (!Number.isInteger(d.earliestDay) || !Number.isInteger(d.latestDay) || d.earliestDay > d.latestDay) throw invalid("bad day range");
  const check = (iso, day, open) => {
    if (iso == null) { if (day !== open) throw invalid("open end must use the sentinel day"); return; }
    const p = parseIsoPartial(iso);
    if (toJdn(p.year, p.month, p.day, d.calendar) !== day) throw invalid(`ISO date ${iso} does not match its day number`);
  };
  check(d.earliest, d.earliestDay, OPEN_EARLIEST_DAY);
  check(d.latest, d.latestDay, OPEN_LATEST_DAY);
  return d;
}
