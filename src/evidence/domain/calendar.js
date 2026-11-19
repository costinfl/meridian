// Julian / Gregorian helpers (Phase 9 review, d). Romanian civil records used the Julian calendar until 31 March 1919;
// the next day was 14 April 1919 (Gregorian). The Orthodox Church changed on 1 October 1924 (Julian) = 14 October 1924,
// so church registers can still be Julian between 1919 and 1924. Conversion goes through the Julian Day Number.
import { toJdn, fromJdn } from "./fuzzyDate.js";

export const CIVIL_SWITCH = { julian: { year: 1919, month: 3, day: 31 }, gregorianFirst: { year: 1919, month: 4, day: 14 } };
export const CHURCH_SWITCH = { julian: { year: 1924, month: 9, day: 30 }, gregorianFirst: { year: 1924, month: 10, day: 14 } };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const other = (calendar) => (calendar === "julian" ? "gregorian" : "julian");
const before = (a, b) => a.year < b.year || (a.year === b.year && (a.month < b.month || (a.month === b.month && a.day <= b.day)));

/** The same day in the other calendar (or in `to`). */
export function convertDate({ year, month, day }, from, to = other(from)) {
  if (from === to) return { year, month, day };
  return fromJdn(toJdn(year, month, day, from), to);
}

/**
 * The calendar a Romanian record of this date most likely used: Julian up to 31 March 1919 for civil records (to
 * 30 September 1924 for church registers), else Gregorian. Month and day are optional (the year alone decides when
 * they are missing; 1919 alone counts as Gregorian, as most of it was).
 */
export function likelyCalendar(year, month = null, day = null, { church = false } = {}) {
  if (!Number.isInteger(year)) return "gregorian";
  const sw = church ? CHURCH_SWITCH.julian : CIVIL_SWITCH.julian;
  if (year !== sw.year) return year < sw.year ? "julian" : "gregorian";
  if (!Number.isInteger(month)) return "gregorian";                  // a year alone: most of it was Gregorian
  return before({ year, month, day: Number.isInteger(day) ? day : 1 }, sw) ? "julian" : "gregorian";
}

export const formatDay = ({ year, month, day }) => `${day} ${MONTHS[month - 1]} ${year}`;
const label = (calendar) => (calendar === "julian" ? "Julian" : "Gregorian");

/**
 * Both calendars for a day-precise date: "28 Mar 1866 (Julian) = 9 Apr 1866 (Gregorian)". Null for a date that is not
 * a single day (a month or a year is the same span in both, give or take 13 days).
 * @param {{ year, month, day, calendar }|object} d  a plain date with its calendar, or a FuzzyDate
 */
export function bothCalendars(d) {
  if (!d) return null;
  let plain = d;
  if (d.earliestDay != null) {
    if (d.earliestDay !== d.latestDay || !d.calendar) return null;
    plain = { ...fromJdn(d.earliestDay, d.calendar), calendar: d.calendar };
  }
  const { year, month, day, calendar } = plain;
  if (![year, month, day].every(Number.isInteger) || !calendar) return null;
  const o = convertDate({ year, month, day }, calendar);
  return `${formatDay({ year, month, day })} (${label(calendar)}) = ${formatDay(o)} (${label(other(calendar))})`;
}

/** The other calendar's day, in short form, for a FuzzyDate of one day: "9 Apr 1866 Gregorian"; else "". */
export function otherCalendarNote(fd) {
  if (!fd || fd.earliestDay == null || fd.earliestDay !== fd.latestDay || !fd.calendar) return "";
  const o = fromJdn(fd.earliestDay, other(fd.calendar));
  return `${formatDay(o)} ${label(other(fd.calendar))}`;
}
