import { invalid, notFound } from "../domain/errors.js";
import { fuzzyDate } from "../domain/fuzzyDate.js";
import { defaultCalendar } from "./contract.js";

// Reviewing proposals (P6.T4). Confirming and rejecting are the assertion store's own user actions
// (confirmAssertion / rejectAssertion). A correction is a NEW assertion entered by the researcher that supersedes
// the proposal (same subject, property and citation); the proposal stays, superseded, for the record.

const DATE_PROPERTIES = new Set(["birth.date", "death.date", "event.date"]);

/**
 * Normalised value of a corrected date or age typed in the review form.
 *   date: { year, month?, day?, calendar? }  ->  FuzzyDate (calendar defaults like the contract: Julian before 1919)
 *   age:  { value, unit? }                    ->  { value, unit }
 */
export function normalizedCorrection(property, { asWritten = "", year, month, day, calendar, value, unit } = {}) {
  const int = (v) => (v === "" || v == null ? null : Number(v));
  if (DATE_PROPERTIES.has(property)) {
    const y = int(year);
    if (!Number.isInteger(y)) throw invalid("a corrected date needs at least the year");
    return fuzzyDate({ asWritten, year: y, month: int(month), day: int(day), calendar: calendar || defaultCalendar(y) });
  }
  if (property === "age") {
    const n = int(value);
    if (!Number.isInteger(n) || n < 0) throw invalid("a corrected age needs a whole number");
    return { value: n, unit: unit || "years" };
  }
  return undefined;
}

/**
 * USER ACTION: correct a proposed (or confirmed) value. Writes a `manual` run and a confirmed assertion that
 * supersedes the old one. `fields` = { originalValue, ...date or age parts }.
 */
export async function correctAssertion({ library, assertionId, fields, decidedBy = "user" }) {
  const old = await library.assertions.get(assertionId);
  if (!old) throw notFound("Assertion", assertionId);
  if (old.objectPersonaId) throw invalid("a relation cannot be corrected here; reject it instead");
  const originalValue = String(fields?.originalValue ?? "").trim();
  if (!originalValue) throw invalid("enter the corrected value as written");
  const normalizedValue = normalizedCorrection(old.property, { ...fields, asWritten: originalValue });
  const run = await library.runs.startRun({ processor: "manual", processorVersion: "review-1", parameters: { action: "correct", assertionId } });
  try {
    const a = await library.assertions.enterAsUser({
      subjectType: old.subjectType, subjectId: old.subjectId, property: old.property, originalValue,
      ...(normalizedValue !== undefined ? { normalizedValue } : {}),
      runId: run.id, citation: old.citation, supersedesId: old.id,
    }, { decidedBy });
    await library.runs.finishRun(run.id, "succeeded");
    return a;
  } catch (e) {
    await library.runs.finishRun(run.id, "failed").catch(() => {});
    throw e;
  }
}

/** Pages of a copy with proposals waiting: [{ page, proposed }], in page order. */
export async function proposalsByPage(library, copyId, recordsOfPage) {
  const out = [];
  for (const page of await library.pages.listPages(copyId)) {
    const items = await recordsOfPage(library, page.id);
    const proposed = items.reduce((n, i) => n + i.counts.proposed, 0);
    if (proposed) out.push({ page, proposed });
  }
  return out;
}
