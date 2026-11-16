import Ajv from "ajv";
import schema from "./extraction-v1.schema.json";
import { fuzzyDate } from "../domain/fuzzyDate.js";

// Extraction contract v1 (P6.T1): what an extractor returns for one page or region, how it is checked, and how
// a valid result becomes store inputs (a record, its personas, and proposed assertions). Pure: nothing is stored here.

export const SCHEMA_VERSION = "1";
export const EXTRACTION_SCHEMA = schema;

/**
 * Calendar of a date that does not state one. Romania used the Julian calendar for civil and church records
 * until 1919 (the Gregorian calendar was adopted on 1 April 1919), so older dates default to Julian.
 */
export const defaultCalendar = (year) => (year < 1919 ? "julian" : "gregorian");
export const MIN_YEAR = 1000;

let compiled = null;
function ajvValidate() {
  if (!compiled) compiled = new Ajv({ allErrors: true, strict: false }).compile(schema);
  return compiled;
}

const fmt = (e) => `${e.instancePath || "(root)"} ${e.message}${e.params?.allowedValues ? ` (${e.params.allowedValues.join(", ")})` : ""}${e.params?.additionalProperty ? ` '${e.params.additionalProperty}'` : ""}`;

function checkDate(d, where, errors, maxYear) {
  if (!d || d.year == null) {
    if (d && (d.month != null || d.day != null)) errors.push(`${where}: month or day without a year`);
    return;
  }
  if (d.year < MIN_YEAR || d.year > maxYear) errors.push(`${where}: year ${d.year} is not plausible`);
  if (d.day != null && d.month == null) errors.push(`${where}: day without a month`);
  if (d.year >= MIN_YEAR && d.year <= maxYear) {
    try { fuzzyDate({ year: d.year, month: d.month ?? null, day: d.day ?? null, calendar: d.calendar ?? defaultCalendar(d.year), modifier: d.modifier ?? null }); }
    catch (e) { errors.push(`${where}: ${e.message}`); }
  }
}

/**
 * Validate an extractor's output: the JSON Schema, then the rules a schema cannot express (persona keys unique
 * and referenced keys present, a box with x0 < x1 and y0 < y1, real calendar dates in a plausible range).
 * Returns { ok, errors: string[] }.
 */
export function validateExtraction(output, { maxYear = new Date().getFullYear() } = {}) {
  const v = ajvValidate();
  if (!v(output)) return { ok: false, errors: v.errors.map(fmt) };
  const errors = [];
  output.records.forEach((r, i) => {
    const at = `/records/${i}`;
    if (r.box && !(r.box.x0 < r.box.x1 && r.box.y0 < r.box.y1)) errors.push(`${at}/box: x0 < x1 and y0 < y1 are required`);
    if (r.eventDate) checkDate(r.eventDate, `${at}/eventDate`, errors, maxYear);
    const keys = new Set();
    r.personas.forEach((p, j) => {
      if (keys.has(p.key)) errors.push(`${at}/personas/${j}: duplicate key '${p.key}'`);
      keys.add(p.key);
      if (p.birthDate) checkDate(p.birthDate, `${at}/personas/${j}/birthDate`, errors, maxYear);
      if (p.deathDate) checkDate(p.deathDate, `${at}/personas/${j}/deathDate`, errors, maxYear);
    });
    (r.relations ?? []).forEach((rel, j) => {
      if (!keys.has(rel.subject)) errors.push(`${at}/relations/${j}: unknown subject '${rel.subject}'`);
      if (!keys.has(rel.object)) errors.push(`${at}/relations/${j}: unknown object '${rel.object}'`);
      if (rel.subject === rel.object) errors.push(`${at}/relations/${j}: a person cannot be related to itself`);
    });
  });
  return { ok: errors.length === 0, errors };
}

const toFuzzy = (d) => fuzzyDate({
  asWritten: d.asWritten, year: d.year, month: d.month ?? null, day: d.day ?? null,
  calendar: d.calendar ?? defaultCalendar(d.year), modifier: d.modifier ?? null,
});
const text = (s) => (typeof s === "string" ? s.trim() : "");

/**
 * Turn VALID output into store inputs. Each record gives:
 *   { kind, box, event, personas: [{ key, nameAsWritten, role, statedAge, occupation, residence, houseNumber }],
 *     assertions: [{ subject: "record" | personaKey, property, originalValue, normalizedValue?, objectKey?, confidence }] }
 * Every stated fact becomes one assertion (originalValue as written). A date without a year is kept as written
 * only, under the extension property `x-<property>-unparsed`, because a date assertion needs a normalised value.
 */
export function toEvidence(output) {
  return output.records.map((r) => {
    const confidence = r.confidence ?? null;
    const assertions = [];
    const add = (subject, property, originalValue, extra = {}) => {
      if (!text(originalValue) && property !== "role") return;
      assertions.push({ subject, property, originalValue: text(originalValue), confidence, ...extra });
    };
    const addDate = (subject, property, d) => {
      if (!d || !text(d.asWritten) && d.year == null) return;
      if (d.year == null) { add(subject, `x-${property}-unparsed`, d.asWritten); return; }
      add(subject, property, d.asWritten || String(d.year), { normalizedValue: toFuzzy(d) });
    };

    const event = r.eventDate?.year != null ? toFuzzy(r.eventDate) : null;
    addDate("record", "event.date", r.eventDate);
    add("record", "event.place", r.eventPlace);

    const personas = r.personas.map((p) => {
      add(p.key, "name", p.nameAsWritten);
      add(p.key, "role", p.role);
      if (p.sex && p.sex !== "unknown") add(p.key, "sex", p.sex);
      if (p.age) add(p.key, "age", p.age.asWritten || String(p.age.value), { normalizedValue: { value: p.age.value, unit: p.age.unit ?? "years" } });
      add(p.key, "occupation", p.occupation);
      add(p.key, "residence", p.residence);
      add(p.key, "houseNumber", p.houseNumber);
      add(p.key, "x-religion", p.religion);
      addDate(p.key, "birth.date", p.birthDate);
      add(p.key, "birth.place", p.birthPlace);
      addDate(p.key, "death.date", p.deathDate);
      add(p.key, "death.place", p.deathPlace);
      return {
        key: p.key, nameAsWritten: p.nameAsWritten.trim(), role: p.role,
        statedAge: p.age ? { value: p.age.value, unit: p.age.unit ?? "years", asWritten: p.age.asWritten ?? "" } : null,
        occupation: text(p.occupation), residence: text(p.residence), houseNumber: text(p.houseNumber),
      };
    });
    for (const rel of r.relations ?? []) {
      assertions.push({ subject: rel.subject, property: rel.property, originalValue: text(rel.asWritten), objectKey: rel.object, confidence });
    }
    return { kind: r.kind, box: r.box ?? null, event, personas, assertions };
  });
}
