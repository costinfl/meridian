import { invalid, notFound } from "../domain/errors.js";

// Writing contract output (after toEvidence) into the library: a record (with a child region when the extractor
// gave a box), its personas, and one assertion per stated fact, all cited to the record's region.
// HOW assertions are written is the caller's choice: an automated extractor passes `propose`, the researcher's own
// entry passes `enterAsUser`. This module decides nothing on its own.

/** A box given relative to `parent` (0-1 inside it) as a box on the whole page. */
export function boxInParent(parent, box) {
  const w = parent.x1 - parent.x0, h = parent.y1 - parent.y0;
  const r = (v) => Math.round(v * 1e6) / 1e6;
  return { x0: r(parent.x0 + box.x0 * w), y0: r(parent.y0 + box.y0 * h), x1: r(parent.x0 + box.x1 * w), y1: r(parent.y0 + box.y1 * h) };
}

/**
 * @param {object} a
 * @param {object} a.library
 * @param {string} a.runId       the run that read these records (I3)
 * @param {string} a.regionId    the region that was read (whole page or a drawn region)
 * @param {object[]} a.records   toEvidence(output)
 * @param {(input) => Promise<object>} a.addAssertion   library.assertions.propose or .enterAsUser
 * @param {(a: { regionId, property, normalizedValue, originalValue }) => Promise<boolean>} [a.skip]  e.g. "rejected before"
 * @returns {Promise<{ written: { record, personas, assertions }[], skipped: number }>}
 */
export async function writeRecords({ library, runId, regionId, records, addAssertion, skip }) {
  const region = await library.pages.getRegion(regionId);
  if (!region) throw notFound("Region", regionId);
  const written = [];
  let skipped = 0;
  for (const item of records) {
    let citeId = regionId;
    if (item.box) {
      const child = await library.pages.addRegion({ pageId: region.pageId, parentRegionId: regionId, box: boxInParent(region.box, item.box), kind: "block", label: `${item.kind} record` });
      citeId = child.id;
    }
    const { record, personas } = await library.records.createRecord({
      kind: item.kind, regionIds: [citeId], event: item.event, runId,
      personas: item.personas.map((p) => ({ nameAsWritten: p.nameAsWritten, role: p.role, statedAge: p.statedAge, occupation: p.occupation, residence: p.residence, houseNumber: p.houseNumber })),
    });
    const idOf = new Map(item.personas.map((p, i) => [p.key, personas[i].id]));
    const subjectOf = (key) => {
      if (key === "record") return { subjectType: "record", subjectId: record.id };
      if (!idOf.has(key)) throw invalid(`unknown persona key '${key}'`);
      return { subjectType: "persona", subjectId: idOf.get(key) };
    };
    const assertions = [];
    for (const a of item.assertions) {
      const input = {
        ...subjectOf(a.subject), property: a.property, originalValue: a.originalValue,
        ...(a.normalizedValue !== undefined ? { normalizedValue: a.normalizedValue } : {}),
        objectPersonaId: a.objectKey ? idOf.get(a.objectKey) : null,
        confidence: a.confidence ?? null, runId, citation: { regionId: citeId },
      };
      if (skip && (await skip({ regionId: citeId, regionIds: [citeId, regionId], property: a.property, originalValue: a.originalValue, normalizedValue: input.normalizedValue }))) { skipped++; continue; }
      assertions.push(await addAssertion(input));
    }
    written.push({ record, personas, assertions });
  }
  return { written, skipped };
}
