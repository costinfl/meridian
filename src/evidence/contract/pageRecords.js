// Read-only view of what has been recorded on one page: its current regions and, per record, the personas and
// every assertion (with its effective status). Used by the Records tab and the review queue.

/** Regions of a page that are not superseded (the whole-page region first). */
export async function currentRegionsOf(library, pageId) {
  const all = await library.pages.listRegions(pageId);
  const superseded = new Set(all.map((r) => r.supersedesId).filter(Boolean));
  return all.filter((r) => !superseded.has(r.id)).sort((a, b) => (a.kind === "page" ? -1 : b.kind === "page" ? 1 : (a.createdAt < b.createdAt ? -1 : 1)));
}

/**
 * [{ record, regionId, region, recordAssertions, personas: [{ persona, assertions }], counts: { proposed, confirmed, rejected } }]
 * for every record citing any region of the page (superseded regions included, so nothing read from an old box
 * disappears). Newest records first. Assertions superseded by a correction are left out; the correction is shown.
 */
export async function recordsOfPage(library, pageId) {
  const regions = await library.pages.listRegions(pageId);
  const byId = new Map(regions.map((r) => [r.id, r]));
  const seen = new Set();
  const out = [];
  for (const region of regions) {
    for (const record of await library.records.recordsByRegion(region.id)) {
      if (seen.has(record.id)) continue;
      seen.add(record.id);
      const current = async (subjectId) => library.assertions.listCurrentBySubject(subjectId);
      const recordAssertions = await current(record.id);
      const personas = [];
      for (const persona of await library.records.personasOf(record.id)) personas.push({ persona, assertions: await current(persona.id) });
      const all = [...recordAssertions, ...personas.flatMap((p) => p.assertions)];
      const counts = { proposed: 0, confirmed: 0, rejected: 0 };
      for (const a of all) counts[a.status]++;
      const regionId = record.regionIds[0];
      out.push({ record, regionId, region: byId.get(regionId) ?? null, recordAssertions, personas, counts });
    }
  }
  return out.sort((a, b) => (a.record.createdAt < b.record.createdAt ? 1 : -1));
}
