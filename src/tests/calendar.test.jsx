import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { convertDate, likelyCalendar, bothCalendars, otherCalendarNote } from "../evidence/domain/calendar.js";
import { fuzzyDate } from "../evidence/domain/fuzzyDate.js";
import { defaultCalendar } from "../evidence/contract/contract.js";
import DateConverter from "../components/evidence/DateConverter.jsx";

afterEach(() => cleanup());

describe("Julian / Gregorian helpers (Phase 9 review, d)", () => {
  it("known pairs, the switch of 1919, century leap rules, the turn of the year", () => {
    expect(convertDate({ year: 1866, month: 3, day: 28 }, "julian")).toEqual({ year: 1866, month: 4, day: 9 });
    expect(convertDate({ year: 1919, month: 3, day: 31 }, "julian")).toEqual({ year: 1919, month: 4, day: 13 });
    expect(convertDate({ year: 1919, month: 4, day: 14 }, "gregorian", "julian")).toEqual({ year: 1919, month: 4, day: 1 });
    expect(convertDate({ year: 1850, month: 12, day: 25 }, "julian")).toEqual({ year: 1851, month: 1, day: 6 });   // year shifts
    expect(convertDate({ year: 1700, month: 2, day: 29 }, "julian")).toEqual({ year: 1700, month: 3, day: 11 });  // Julian leap day, not Gregorian
    expect(convertDate({ year: 1800, month: 3, day: 1 }, "julian")).toEqual({ year: 1800, month: 3, day: 13 });   // 12 days in the 1700s
    expect(convertDate({ year: 1900, month: 3, day: 1 }, "julian")).toEqual({ year: 1900, month: 3, day: 14 });   // 13 days after 1900-02-28
  });

  it("round trips 1700–1950", () => {
    for (let y = 1700; y <= 1950; y += 7) for (const [m, d] of [[1, 1], [2, 28], [6, 15], [12, 31]]) {
      const g = convertDate({ year: y, month: m, day: d }, "julian");
      expect(convertDate(g, "gregorian")).toEqual({ year: y, month: m, day: d });
    }
  });

  it("likely calendar: Julian until 31 March 1919 (church registers until 30 September 1924)", () => {
    expect(likelyCalendar(1866)).toBe("julian");
    expect(likelyCalendar(1919, 3, 31)).toBe("julian");
    expect(likelyCalendar(1919, 4, 14)).toBe("gregorian");
    expect(likelyCalendar(1919)).toBe("gregorian");
    expect(likelyCalendar(1920)).toBe("gregorian");
    expect(likelyCalendar(1922, 5, 1, { church: true })).toBe("julian");
    expect(defaultCalendar(1919, 6, 1)).toBe("gregorian");                       // the contract uses it
  });

  it("both calendars for a day; nothing for a month or a year", () => {
    expect(bothCalendars({ year: 1866, month: 3, day: 28, calendar: "julian" })).toBe("28 Mar 1866 (Julian) = 9 Apr 1866 (Gregorian)");
    const fd = fuzzyDate({ year: 1866, month: 3, day: 28, calendar: "julian" });
    expect(bothCalendars(fd)).toBe("28 Mar 1866 (Julian) = 9 Apr 1866 (Gregorian)");
    expect(otherCalendarNote(fd)).toBe("9 Apr 1866 Gregorian");
    expect(bothCalendars(fuzzyDate({ year: 1866, month: 3, calendar: "julian" }))).toBeNull();
    expect(otherCalendarNote(null)).toBe("");
  });

  it("the converter", () => {
    render(<DateConverter />);
    fireEvent.change(screen.getByLabelText("Converter day"), { target: { value: "28" } });
    fireEvent.change(screen.getByLabelText("Converter month"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Converter year"), { target: { value: "1866" } });
    expect(screen.getByTestId("calendar-line").textContent).toBe("28 Mar 1866 (Julian) = 9 Apr 1866 (Gregorian)");
    fireEvent.change(screen.getByLabelText("Converter calendar"), { target: { value: "gregorian" } });
    expect(screen.getByTestId("calendar-line").textContent).toBe("28 Mar 1866 (Gregorian) = 16 Mar 1866 (Julian)");
  });
});
