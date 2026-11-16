import { invalid } from "../domain/errors.js";
import { validateExtraction, toEvidence, SCHEMA_VERSION } from "./contract.js";
import { writeRecords } from "./writeRecords.js";

// Manual entry (P6.T2): the researcher types a record seen on the page. The form is turned into the same
// extraction contract an LLM returns, validated the same way, and saved with every claim CONFIRMED, because the
// researcher states it (agent `manual`). The record cites the region the researcher drew (or the whole page).

const MANUAL_VERSION = "manual-entry-1";
const str = (v) => (v == null ? "" : String(v).trim());
const int = (v) => { const s = str(v); if (!s) return undefined; const n = Number(s); return Number.isInteger(n) ? n : NaN; };

/**
 * Relations a researcher usually means, suggested from roles (each is shown with a tick box, never saved unasked):
 * child -> father/mother childOf; godparent -> child godparentOf; groom -> bride spouseOf; informant -> deceased informantFor.
 */
export const RELATION_RULES = [
  { from: "child", to: "father", property: "childOf" },
  { from: "child", to: "mother", property: "childOf" },
  { from: "godparent", to: "child", property: "godparentOf" },
  { from: "groom", to: "bride", property: "spouseOf" },
  { from: "informant", to: "deceased", property: "informantFor" },
];
export function suggestRelations(personas) {
  const out = [];
  for (const rule of RELATION_RULES) {
    for (const s of personas.filter((p) => p.role === rule.from)) {
      for (const o of personas.filter((p) => p.role === rule.to && p.key !== s.key)) out.push({ subject: s.key, property: rule.property, object: o.key });
    }
  }
  return out;
}

function dateOf(d) {
  if (!d || ![d.asWritten, d.year, d.month, d.day].some((v) => str(v))) return undefined;
  const out = { asWritten: str(d.asWritten) };
  for (const k of ["year", "month", "day"]) { const n = int(d[k]); if (n !== undefined) out[k] = n; }
  if (d.calendar) out.calendar = d.calendar;
  if (!out.asWritten) out.asWritten = [out.day, out.month, out.year].filter((v) => v != null).join(".");
  return out;
}

/**
 * The form as contract output (pure). Form:
 *   { kind, eventDate: { asWritten, year, month, day, calendar }, eventPlace,
 *     personas: [{ key, nameAsWritten, role, sex, ageAsWritten, ageValue, ageUnit, occupation, residence, houseNumber, religion }],
 *     relations: [{ subject, property, object, asWritten }] }
 * Empty persona rows (no name) are dropped.
 */
export function buildManualRecord(form) {
  const personas = (form.personas ?? []).filter((p) => str(p.nameAsWritten)).map((p) => {
    const o = { key: p.key, nameAsWritten: str(p.nameAsWritten), role: p.role || "other" };
    if (p.sex && p.sex !== "unknown") o.sex = p.sex;
    const age = int(p.ageValue);
    if (age !== undefined) o.age = { asWritten: str(p.ageAsWritten) || String(p.ageValue).trim(), value: age, unit: p.ageUnit || "years" };
    for (const k of ["occupation", "residence", "houseNumber", "religion"]) if (str(p[k])) o[k] = str(p[k]);
    return o;
  });
  const keys = new Set(personas.map((p) => p.key));
  const record = { kind: form.kind || "other", personas };
  const date = dateOf(form.eventDate);
  if (date) record.eventDate = date;
  if (str(form.eventPlace)) record.eventPlace = str(form.eventPlace);
  const relations = (form.relations ?? []).filter((r) => keys.has(r.subject) && keys.has(r.object))
    .map((r) => ({ subject: r.subject, property: r.property, object: r.object, ...(str(r.asWritten) ? { asWritten: str(r.asWritten) } : {}) }));
  if (relations.length) record.relations = relations;
  return { schemaVersion: SCHEMA_VERSION, records: [record] };
}

/**
 * USER ACTION: save a manually entered record on a region. Validates like an extractor's output; on success writes
 * a `manual` run, the record, its personas and CONFIRMED assertions (enterAsUser), all citing `regionId`.
 * Returns { record, personas, assertions, runId } or throws with the validation errors.
 */
export async function saveManualRecord({ library, regionId, form }) {
  const output = buildManualRecord(form);
  if (!output.records[0].personas.length) throw invalid("enter at least one person (a name as written)");
  const v = validateExtraction(output);
  if (!v.ok) throw invalid(v.errors.join("; "));
  const run = await library.runs.startRun({ processor: "manual", processorVersion: MANUAL_VERSION, parameters: { regionId }, schemaVersion: SCHEMA_VERSION });
  try {
    const { written } = await writeRecords({ library, runId: run.id, regionId, records: toEvidence(output), addAssertion: (input) => library.assertions.enterAsUser(input) });
    await library.runs.finishRun(run.id, "succeeded");
    return { ...written[0], runId: run.id };
  } catch (e) {
    await library.runs.finishRun(run.id, "failed").catch(() => {});
    throw e;
  }
}
