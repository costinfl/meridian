import { newId, nowIso } from "../ids.js";
import { invalid, notFound, requireOneOf, requireString } from "../domain/errors.js";
import { validateFuzzyDate } from "../domain/fuzzyDate.js";
import { dayRangeOf } from "../domain/validity.js";
import { dmCodesOfName, searchKey } from "../domain/normalize.js";

export const RECORD_KINDS = ["baptism", "birth", "marriage", "death", "burial", "census", "notice", "deed", "other"];
export const ROLES = [
  "child", "father", "mother", "godparent", "witness", "groom", "bride", "deceased", "priest",
  "informant", "spouse", "head", "member", "subject", "other",
];
export const AGE_UNITS = ["years", "months", "days"];
const RECORDS = "evRecords", PERSONAS = "evPersonas";

function checkAge(age) {
  if (age == null) return null;
  if (!Number.isInteger(age.value) || age.value < 0) throw invalid("statedAge.value must be an integer >= 0");
  const unit = age.unit ?? "years";
  requireOneOf(unit, AGE_UNITS, "statedAge.unit");
  if (age.slack != null && !(Number.isInteger(age.slack) && age.slack >= 0)) throw invalid("statedAge.slack must be an integer >= 0");
  return { value: age.value, unit, slack: age.slack ?? 0, asWritten: age.asWritten ?? "" };
}

/**
 * Records (one event entry in a source) and Personas (a person as described in one record).
 * Both keep what was read, as written; the truth about each claim lives in assertions, and the
 * persona's convenience view is derived from them (see personaView). Hence no update operations.
 */
export function createRecordStore(storage) {
  function makeRecord(input) {
    const event = input.event == null ? null : validateFuzzyDate(input.event);
    const regionIds = [...new Set(input.regionIds ?? [])];
    if (!regionIds.length) throw invalid("a record needs at least one region (its citation)");
    return {
      id: newId(),
      kind: requireOneOf(input.kind ?? "other", RECORD_KINDS, "kind"),
      regionIds,
      event,
      eventEarliestDay: event ? event.earliestDay : null, // denormalised for the date-range index
      eventLatestDay: event ? event.latestDay : null,
      placeId: input.placeId ?? null,
      runId: requireString(input.runId, "runId"),
      createdAt: nowIso(),
    };
  }

  function makePersona(input, recordId) {
    const nameAsWritten = requireString(input.nameAsWritten, "nameAsWritten");
    return {
      id: newId(),
      recordId,
      nameAsWritten,
      nameKey: searchKey(nameAsWritten),
      surnameDm: dmCodesOfName(nameAsWritten), // phonetic codes of all name tokens
      role: requireOneOf(input.role ?? "other", ROLES, "role"),
      statedAge: checkAge(input.statedAge),
      occupation: input.occupation ?? "",
      residence: input.residence ?? "",
      residencePlaceId: input.residencePlaceId ?? null,
      houseNumber: input.houseNumber ?? "",
      regionId: input.regionId ?? null, // where on the page this person appears, if more specific than the record
      createdAt: nowIso(),
    };
  }

  async function checkRefs(o, record, personas) {
    for (const rid of record.regionIds) if (!(await o.get("evRegions", rid))) throw notFound("Region", rid);
    if (!(await o.get("evRuns", record.runId))) throw notFound("ProcessingRun", record.runId);
    if (record.placeId && !(await o.get("evPlaces", record.placeId))) throw notFound("Place", record.placeId);
    for (const p of personas) {
      if (p.regionId && !(await o.get("evRegions", p.regionId))) throw notFound("Region", p.regionId);
      if (p.residencePlaceId && !(await o.get("evPlaces", p.residencePlaceId))) throw notFound("Place", p.residencePlaceId);
    }
  }
  const STORES = [RECORDS, PERSONAS, "evRegions", "evRuns", "evPlaces"];

  return {
    /** Create a record together with its personas in one transaction. */
    async createRecord(input = {}) {
      const record = makeRecord(input);
      const personas = (input.personas ?? []).map((p) => makePersona(p, record.id));
      await storage.dbTransact(STORES, "readwrite", async (o) => {
        await checkRefs(o, record, personas);
        await o.add(RECORDS, record);
        for (const p of personas) await o.add(PERSONAS, p);
      });
      return { record, personas };
    },
    /** Add another person to an existing record (for example a godparent found later). */
    async addPersona(recordId, input = {}) {
      const persona = makePersona(input, recordId);
      await storage.dbTransact(STORES, "readwrite", async (o) => {
        if (!(await o.get(RECORDS, recordId))) throw notFound("Record", recordId);
        await checkRefs(o, { regionIds: [], runId: (await o.get(RECORDS, recordId)).runId, placeId: null }, [persona]);
        await o.add(PERSONAS, persona);
      });
      return persona;
    },
    getRecord: (id) => storage.dbGet(RECORDS, id).then((r) => r ?? null),
    getPersona: (id) => storage.dbGet(PERSONAS, id).then((r) => r ?? null),
    personasOf: (recordId) => storage.dbGetAllByIndex(PERSONAS, "byRecord", recordId),
    recordsByRegion: (regionId) => storage.dbGetAllByIndex(RECORDS, "byRegion", regionId),
    recordsByPlace: (placeId) => storage.dbGetAllByIndex(RECORDS, "byPlace", placeId),
    recordsByKind: (kind) => storage.dbGetAllByIndex(RECORDS, "byKind", kind),
    /** Records whose event date overlaps `when` (ISO date, FuzzyDate, day number or [from, to]). */
    async recordsOverlapping(when) {
      const [from, to] = dayRangeOf(when);
      const candidates = await storage.dbGetAllByIndex(RECORDS, "byEarliestDay", IDBKeyRange.upperBound(to));
      return candidates.filter((r) => r.eventLatestDay >= from).sort((a, b) => a.eventEarliestDay - b.eventEarliestDay);
    },
    /** Personas with exactly this folded name (case/accent-insensitive). */
    findPersonasByName: (name) => storage.dbGetAllByIndex(PERSONAS, "byNameKey", searchKey(name)),
    /** Personas whose name has a token with this Daitch-Mokotoff code. */
    findPersonasByDm: (code) => storage.dbGetAllByIndex(PERSONAS, "bySurnameDm", code),
  };
}
