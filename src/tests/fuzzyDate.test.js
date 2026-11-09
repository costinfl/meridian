import { describe, it, expect } from "vitest";
import {
  toJdn, fromJdn, fuzzyDate, fuzzyDateFromIso, fromStatedAge, overlaps, containsDay, validateFuzzyDate,
  isLeapYear, daysInMonth, parseIsoPartial, OPEN_EARLIEST_DAY, OPEN_LATEST_DAY, dayOf,
} from "../evidence/domain/fuzzyDate.js";

describe("calendar arithmetic", () => {
  it("matches reference Julian Day Numbers", () => {
    expect(toJdn(2000, 1, 1)).toBe(2451545);
    expect(toJdn(1582, 10, 15)).toBe(2299161);
    expect(toJdn(1582, 10, 5, "julian")).toBe(2299161); // the day the Gregorian calendar began
    expect(toJdn(1970, 1, 1)).toBe(2440588);
  });
  it("round-trips every day over a long span in both calendars", () => {
    for (const cal of ["gregorian", "julian"]) {
      for (let j = toJdn(1700, 1, 1, cal); j < toJdn(1704, 1, 1, cal); j++) {
        const p = fromJdn(j, cal);
        expect(toJdn(p.year, p.month, p.day, cal)).toBe(j);
      }
    }
    for (const j of [0, 1721426, 2299160, 2392801, 5373484]) {
      const g = fromJdn(j, "gregorian"); expect(toJdn(g.year, g.month, g.day, "gregorian")).toBe(j);
      const u = fromJdn(j, "julian"); expect(toJdn(u.year, u.month, u.day, "julian")).toBe(j);
    }
  });
  it("converts Julian to Gregorian through the day number (12 days apart in the 1800s)", () => {
    expect(fromJdn(toJdn(1843, 3, 12, "julian"), "gregorian")).toEqual({ year: 1843, month: 3, day: 24 });
    expect(fromJdn(toJdn(1900, 2, 29, "julian"), "gregorian")).toEqual({ year: 1900, month: 3, day: 13 }); // 1900 is a Julian leap year only
    expect(fromJdn(toJdn(1918, 1, 31, "julian"), "gregorian")).toEqual({ year: 1918, month: 2, day: 13 });
  });
  it("knows leap years per calendar and validates dates", () => {
    expect(isLeapYear(1900, "gregorian")).toBe(false);
    expect(isLeapYear(1900, "julian")).toBe(true);
    expect(isLeapYear(2000, "gregorian")).toBe(true);
    expect(daysInMonth(1900, 2, "julian")).toBe(29);
    expect(() => toJdn(1900, 2, 29, "gregorian")).toThrow(/day out of range/);
    expect(() => toJdn(1843, 13, 1)).toThrow(/month/);
    expect(() => toJdn(1843, 4, 31)).toThrow(/day/);
    expect(() => toJdn(1843, 1, 1, "hebrew")).toThrow(/calendar/);
    expect(() => toJdn(1843.5, 1, 1)).toThrow(/integers/);
  });
  it("parses partial ISO dates", () => {
    expect(parseIsoPartial("1843-03-12")).toEqual({ year: 1843, month: 3, day: 12 });
    expect(parseIsoPartial("1843-03")).toEqual({ year: 1843, month: 3, day: null });
    expect(parseIsoPartial("1843")).toEqual({ year: 1843, month: null, day: null });
    expect(() => parseIsoPartial("12 Martie 1843")).toThrow(/ISO/);
  });
});

describe("FuzzyDate construction", () => {
  it("day, month and year precision", () => {
    const day = fuzzyDate({ asWritten: "12 Martie 1843", year: 1843, month: 3, day: 12 });
    expect(day).toMatchObject({ asWritten: "12 Martie 1843", earliest: "1843-03-12", latest: "1843-03-12", precision: "day", calendar: "gregorian", derivedFrom: "stated" });
    expect(day.earliestDay).toBe(day.latestDay);
    const month = fuzzyDate({ year: 1843, month: 2 });
    expect(month).toMatchObject({ earliest: "1843-02-01", latest: "1843-02-28", precision: "month" });
    const year = fuzzyDate({ year: 1900 });
    expect(year).toMatchObject({ earliest: "1900-01-01", latest: "1900-12-31", precision: "year" });
    expect(fuzzyDate({ year: 1900, month: 2, calendar: "julian" }).latest).toBe("1900-02-29");
  });
  it("about widens by two years each side; before/after are open-ended", () => {
    expect(fuzzyDate({ year: 1850, modifier: "about" })).toMatchObject({ earliest: "1848-01-01", latest: "1852-12-31", precision: "about" });
    expect(fuzzyDate({ year: 1850, modifier: "about", spanYears: 5 })).toMatchObject({ earliest: "1845-01-01", latest: "1855-12-31" });
    const before = fuzzyDate({ year: 1850, month: 6, day: 1, modifier: "before" });
    expect(before).toMatchObject({ earliest: null, latest: "1850-05-31", earliestDay: OPEN_EARLIEST_DAY, precision: "before" });
    const after = fuzzyDate({ year: 1850, modifier: "after" });
    expect(after).toMatchObject({ earliest: "1851-01-01", latest: null, latestDay: OPEN_LATEST_DAY, precision: "after" });
    expect(() => fuzzyDate({ year: 1850, modifier: "circa" })).toThrow(/modifier/);
  });
  it("builds from ISO text and keeps the calendar flag", () => {
    expect(fuzzyDateFromIso("1843-03-12").precision).toBe("day");
    const j = fuzzyDateFromIso("1843-03-12", { calendar: "julian", asWritten: "12 Martie 1843" });
    expect(j.calendar).toBe("julian");
    expect(j.earliest).toBe("1843-03-12"); // ISO string stays in the stated calendar
    expect(j.earliestDay).toBe(toJdn(1843, 3, 24, "gregorian")); // but the day number is absolute
  });
  it("validates consistency", () => {
    expect(validateFuzzyDate(fuzzyDate({ year: 1850 }))).toBeTruthy();
    expect(validateFuzzyDate(fuzzyDate({ year: 1850, modifier: "before" }))).toBeTruthy();
    expect(() => validateFuzzyDate({ ...fuzzyDate({ year: 1850 }), earliest: "1851-01-01" })).toThrow(/does not match/);
    expect(() => validateFuzzyDate({ ...fuzzyDate({ year: 1850 }), precision: "fuzzy" })).toThrow(/precision/);
    expect(() => validateFuzzyDate(null)).toThrow();
  });
});

describe("FuzzyDate from a stated age", () => {
  const event = (iso) => fuzzyDateFromIso(iso);
  it('"45 ani" at 1885-03-01 means born 1839-03-02 .. 1840-03-01', () => {
    const b = fromStatedAge({ value: 45 }, event("1885-03-01"), { asWritten: "45 ani" });
    expect(b).toMatchObject({ asWritten: "45 ani", earliest: "1839-03-02", latest: "1840-03-01", precision: "year", derivedFrom: "computed", calendar: "gregorian" });
  });
  it("the range is exactly the birthdays that give that age on the event day (checked by brute force)", () => {
    const e = toJdn(1885, 3, 1);
    const b = fromStatedAge({ value: 45 }, event("1885-03-01"));
    const age = (birthJdn) => { // completed years at e
      const bd = fromJdn(birthJdn), ed = fromJdn(e);
      return ed.year - bd.year - (ed.month < bd.month || (ed.month === bd.month && ed.day < bd.day) ? 1 : 0);
    };
    for (let j = b.earliestDay - 400; j <= b.latestDay + 400; j++) {
      expect(age(j) === 45).toBe(j >= b.earliestDay && j <= b.latestDay);
    }
  });
  it("a month or year-level event date widens the range", () => {
    const b = fromStatedAge({ value: 30 }, fuzzyDate({ year: 1885, month: 3 }));
    expect(b).toMatchObject({ earliest: "1854-03-02", latest: "1855-03-31" });
    const y = fromStatedAge({ value: 30 }, fuzzyDate({ year: 1885 }));
    expect(y).toMatchObject({ earliest: "1854-01-02", latest: "1855-12-31" });
  });
  it("age 0, months and days (infants in baptism and burial registers)", () => {
    expect(fromStatedAge({ value: 0 }, event("1850-06-15"))).toMatchObject({ earliest: "1849-06-16", latest: "1850-06-15" });
    expect(fromStatedAge({ value: 3, unit: "months" }, event("1850-06-15"))).toMatchObject({ earliest: "1850-02-16", latest: "1850-03-15", precision: "month" });
    expect(fromStatedAge({ value: 5, unit: "days" }, event("1850-06-15"))).toMatchObject({ earliest: "1850-06-10", latest: "1850-06-10", precision: "day" });
    expect(fromStatedAge({ value: 2, unit: "days" }, event("1850-03-01"))).toMatchObject({ earliest: "1850-02-27", latest: "1850-02-27" });
  });
  it("an approximate age adds slack years on both sides and is flagged 'about'", () => {
    const b = fromStatedAge({ value: 45, slack: 2 }, event("1885-03-01"));
    expect(b).toMatchObject({ earliest: "1837-03-02", latest: "1842-03-01", precision: "about", derivedFrom: "computed" });
  });
  it("leap-day events widen but never narrow the range", () => {
    const b = fromStatedAge({ value: 1 }, event("1884-02-29")); // born in (1882-02-28 .. 1883-03-01]
    expect(b.latestDay).toBeGreaterThanOrEqual(toJdn(1883, 2, 28));
    expect(b.earliestDay).toBeLessThanOrEqual(toJdn(1882, 3, 1));
    expect(b.earliest <= "1882-03-01" && b.latest >= "1883-02-28").toBe(true);
  });
  it("works in the Julian calendar and rejects bad input", () => {
    const e = fuzzyDateFromIso("1885-03-01", { calendar: "julian" });
    const b = fromStatedAge({ value: 45 }, e);
    expect(b.calendar).toBe("julian");
    expect(b.earliest).toBe("1839-03-02");
    expect(() => fromStatedAge({ value: -1 }, e)).toThrow(/age/);
    expect(() => fromStatedAge({ value: 2.5 }, e)).toThrow(/age/);
    expect(() => fromStatedAge({ value: 3, unit: "weeks" }, e)).toThrow(/unit/);
    expect(() => fromStatedAge({ value: 3 }, fuzzyDate({ year: 1850, modifier: "before" }))).toThrow(/both bounds/);
    expect(() => fromStatedAge({ value: 3 }, null)).toThrow(/event/);
  });
});

describe("overlap queries", () => {
  it("is inclusive on both ends and works with open-ended dates", () => {
    const a = fuzzyDateFromIso("1843-03-12"), b = fuzzyDateFromIso("1843-03");
    expect(overlaps(a, b)).toBe(true);
    expect(overlaps(fuzzyDateFromIso("1843-04-01"), b)).toBe(false);
    expect(overlaps(fuzzyDate({ year: 1843, month: 4, day: 1 }), fuzzyDate({ year: 1843, month: 3, day: 31 }))).toBe(false);
    expect(overlaps(fuzzyDate({ year: 1843, month: 3, day: 31 }), fuzzyDate({ year: 1843, month: 3, day: 31 }))).toBe(true);
    expect(overlaps(fuzzyDate({ year: 1850, modifier: "before" }), fuzzyDate({ year: 1700 }))).toBe(true);
    expect(overlaps(fuzzyDate({ year: 1850, modifier: "before" }), fuzzyDate({ year: 1850 }))).toBe(false);
    expect(overlaps(fuzzyDate({ year: 1850, modifier: "after" }), fuzzyDate({ year: 1900 }))).toBe(true);
  });
  it("compares across calendars through absolute day numbers", () => {
    const julian = fuzzyDateFromIso("1843-03-12", { calendar: "julian" });      // = 1843-03-24 Gregorian
    expect(overlaps(julian, fuzzyDateFromIso("1843-03-24"))).toBe(true);
    expect(overlaps(julian, fuzzyDateFromIso("1843-03-12"))).toBe(false);
    expect(containsDay(julian, dayOf(1843, 3, 24))).toBe(true);
    expect(containsDay(julian, dayOf(1843, 3, 12))).toBe(false);
  });
  it("a stated age range overlaps a candidate birth date", () => {
    const born = fromStatedAge({ value: 45 }, fuzzyDateFromIso("1885-03-01"));
    expect(overlaps(born, fuzzyDateFromIso("1839-11-20"))).toBe(true);
    expect(overlaps(born, fuzzyDateFromIso("1841-01-01"))).toBe(false);
    expect(overlaps(born, fuzzyDateFromIso("1838-06"))).toBe(false);
  });
});
