import React, { useState } from "react";
import { C } from "../../theme.js";
import { bothCalendars, likelyCalendar } from "../../evidence/domain/calendar.js";

// Julian / Gregorian converter (Phase 9 review, d): type a date as written in a record, get both calendars.
const small = { font: "400 11.5px Archivo, sans-serif", color: C.inkSoft, lineHeight: 1.5 };
const input = { font: "500 12px Archivo, sans-serif", color: C.ink, background: "#fff", border: `1px solid ${C.rule}`, borderRadius: 3, padding: "2px 6px" };
const int = (v) => (/^\d+$/.test(String(v).trim()) ? Number(v) : null);

/** The live "= … (Gregorian)" line under a date (also used by the manual record form). */
export function CalendarLine({ year, month, day, calendar }) {
  const y = int(year), m = int(month), d = int(day);
  if (!y || !m || !d || m > 12 || d > 31) return null;
  const cal = calendar || likelyCalendar(y, m, d);
  let text = null;
  try { text = bothCalendars({ year: y, month: m, day: d, calendar: cal }); } catch { text = null; }
  if (!text) return null;
  return (
    <div data-testid="calendar-line" style={small}>
      {text}{!calendar && <span> · automatic: Julian until 31 March 1919 (church registers until 30 September 1924)</span>}
    </div>
  );
}

export default function DateConverter() {
  const [f, setF] = useState({ day: "", month: "", year: "", calendar: "julian" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div data-testid="date-converter" style={{ marginTop: 16 }}>
      <div style={{ font: "700 13px Archivo, sans-serif", color: C.ink, marginBottom: 4 }}>Julian / Gregorian dates</div>
      <div style={small}>Romanian civil records used the Julian calendar until 31 March 1919; the next day was 14 April 1919. Church registers changed in October 1924.</div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", margin: "6px 0" }}>
        <input aria-label="Converter day" placeholder="day" value={f.day} onChange={set("day")} style={{ ...input, width: 44 }} />
        <input aria-label="Converter month" placeholder="month" value={f.month} onChange={set("month")} style={{ ...input, width: 52 }} />
        <input aria-label="Converter year" placeholder="year" value={f.year} onChange={set("year")} style={{ ...input, width: 60 }} />
        <select aria-label="Converter calendar" value={f.calendar} onChange={set("calendar")} style={input}>
          <option value="julian">written in Julian</option><option value="gregorian">written in Gregorian</option>
        </select>
      </div>
      <CalendarLine {...f} />
    </div>
  );
}
