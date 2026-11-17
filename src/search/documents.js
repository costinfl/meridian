import { searchKey, dmCodesOfName } from "../evidence/index.js";

// Search documents (P7.T1): one per region that carries text or evidence. Built from a snapshot of the library
// (library.searchIndex.snapshot()), so a full rebuild and an incremental update see exactly the same data (I7).
//
// A document holds the region's text (current transcription, current modern reading, and the values read in it),
// the names written in it with their Daitch-Mokotoff codes and one-hop name variants, its date bounds and places,
// and enough metadata to show the hit (source, page, box) and its status. Rejected and superseded assertions are
// left out: search never finds what the researcher rejected.

const NAME_PROPERTIES = new Set(["name"]);
const DATE_BOUNDS = (v) => (v && Number.isInteger(v.earliestDay) && Number.isInteger(v.latestDay) ? [v.earliestDay, v.latestDay] : null);
const kindOf = (l) => l.kind ?? "transcription";

/** Newest layer of a kind that no other layer of that kind supersedes. */
function currentLayer(layers, kind) {
  const own = layers.filter((l) => kindOf(l) === kind);
  const superseded = new Set(own.map((l) => l.supersedesId).filter(Boolean));
  return own.filter((l) => !superseded.has(l.id)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;
}

/** Folded spellings paired with `key` (either direction), ONE HOP only (the Phase 3 decision). */
export function variantMap(nameVariants) {
  const map = new Map();
  const add = (a, b) => { if (!map.has(a)) map.set(a, new Set()); map.get(a).add(b); };
  for (const r of nameVariants) { add(r.canonicalKey, r.variantKey); add(r.variantKey, r.canonicalKey); }
  return map;
}
const variantsOf = (vmap, folded) => {
  const out = new Set();
  for (const w of folded.split(" ")) for (const v of vmap.get(w) ?? []) out.add(v);
  for (const v of vmap.get(folded) ?? []) out.add(v);
  return out;
};

/** Group helper. */
const groupBy = (rows, key) => {
  const m = new Map();
  for (const r of rows) {
    const keys = Array.isArray(key(r)) ? key(r) : [key(r)];
    for (const k of keys) { if (k == null) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  }
  return m;
};

/**
 * Pre-computed lookups over a snapshot, shared by full and incremental builds.
 * `placeAncestors(placeId, eventDate)` (async, optional) expands places up the hierarchy.
 */
export function prepare(snapshot) {
  const decisionOf = new Map(snapshot.decisions.map((d) => [d.assertionId, d]));
  const status = (a) => decisionOf.get(a.id)?.status ?? a.status;
  const supersededAssertions = new Set(snapshot.assertions.map((a) => a.supersedesId).filter(Boolean));
  const liveAssertions = snapshot.assertions.filter((a) => !supersededAssertions.has(a.id) && status(a) !== "rejected").map((a) => ({ ...a, status: status(a) }));
  return {
    snapshot,
    regionById: new Map(snapshot.regions.map((r) => [r.id, r])),
    pageById: new Map(snapshot.pages.map((p) => [p.id, p])),
    copyById: new Map(snapshot.copies.map((c) => [c.id, c])),
    sourceById: new Map(snapshot.sources.map((s) => [s.id, s])),
    recordById: new Map(snapshot.records.map((r) => [r.id, r])),
    personaById: new Map(snapshot.personas.map((p) => [p.id, p])),
    layersByRegion: groupBy(snapshot.textLayers, (l) => l.regionId),
    recordsByRegion: groupBy(snapshot.records, (r) => r.regionIds),
    personasByRecord: groupBy(snapshot.personas, (p) => p.recordId),
    assertionsByRegion: groupBy(liveAssertions, (a) => a.citationRegionId ?? a.citation?.regionId),
    supersededRegions: new Set(snapshot.regions.map((r) => r.supersedesId).filter(Boolean)),
    vmap: variantMap(snapshot.nameVariants),
  };
}

/** The search document of one region, or null if the region carries nothing to find. */
export async function documentOf(ctx, regionId, { placeAncestors } = {}) {
  const region = ctx.regionById.get(regionId);
  if (!region) return null;
  const layers = ctx.layersByRegion.get(regionId) ?? [];
  const transcription = currentLayer(layers, "transcription");
  const reading = currentLayer(layers, "reading");
  const assertions = ctx.assertionsByRegion.get(regionId) ?? [];
  const records = ctx.recordsByRegion.get(regionId) ?? [];
  // a region that was replaced by a corrected box is indexed only while evidence still cites it
  if (ctx.supersededRegions.has(regionId) && !assertions.length && !records.length) return null;
  if (!transcription?.originalText?.trim() && !reading?.originalText?.trim() && !assertions.length && !records.length) return null;

  const names = new Set(), shownNames = new Set();
  for (const a of assertions) if (NAME_PROPERTIES.has(a.property) && a.originalValue) { names.add(searchKey(a.originalValue)); shownNames.add(a.originalValue); }
  for (const rec of records) for (const p of ctx.personasByRecord.get(rec.id) ?? []) { names.add(searchKey(p.nameAsWritten)); shownNames.add(p.nameAsWritten); }
  names.delete("");
  const dm = new Set(), variants = new Set();
  for (const n of names) {
    for (const c of dmCodesOfName(n)) dm.add(c);
    for (const v of variantsOf(ctx.vmap, n)) if (!names.has(v)) variants.add(v);
  }

  let earliestDay = null, latestDay = null;
  const widen = (b) => { if (!b) return; earliestDay = earliestDay == null ? b[0] : Math.min(earliestDay, b[0]); latestDay = latestDay == null ? b[1] : Math.max(latestDay, b[1]); };
  for (const rec of records) widen(DATE_BOUNDS(rec.event));
  for (const a of assertions) if (/\.date$/.test(a.property)) widen(DATE_BOUNDS(a.normalizedValue));

  const placeIds = new Set();
  for (const rec of records) {
    if (!rec.placeId) continue;
    placeIds.add(rec.placeId);
    if (placeAncestors) for (const p of await placeAncestors(rec.placeId, rec.event)) placeIds.add(p.id);
  }

  const page = ctx.pageById.get(region.pageId) ?? null;
  const copy = page ? ctx.copyById.get(page.copyId) ?? null : null;
  const source = copy?.sourceId ? ctx.sourceById.get(copy.sourceId) ?? null : null;
  const values = assertions.filter((a) => !NAME_PROPERTIES.has(a.property)).map((a) => a.originalValue).filter(Boolean);
  const plain = [transcription?.originalText, reading?.originalText, ...values].filter(Boolean).join("\n");
  // what a hit shows: the values read in the region (names first), then the researcher's reading, then the machine text
  const shownValues = assertions.filter((a) => !NAME_PROPERTIES.has(a.property) && a.property !== "role" && a.property !== "sex").map((a) => a.originalValue).filter(Boolean);
  const shown = [[...shownNames].join(", "), shownValues.join(" · "), reading?.originalText, transcription?.originalText].filter(Boolean).join("\n");
  return {
    id: regionId,
    text: searchKey(plain),
    names: [...names].sort().join(" "),
    variants: [...variants].sort().join(" "),
    dm: [...dm].sort().join(" "),
    // stored fields (shown with a hit, and used by filters)
    pageId: region.pageId, regionKind: region.kind, regionLabel: region.label ?? "", box: region.box,
    pageIndex: page?.pageIndex ?? null, pageLabel: page?.label ?? "",
    copyId: copy?.id ?? null, fileName: copy?.fileName ?? "",
    sourceId: source?.id ?? null, sourceTitle: source?.title ?? "", sourceKind: source?.kind ?? "",
    earliestDay, latestDay, placeIds: [...placeIds].sort(),
    hasConfirmed: assertions.some((a) => a.status === "confirmed"),
    hasProposed: assertions.some((a) => a.status === "proposed"),
    shownNames: [...shownNames].sort(),
    snippetSource: shown.slice(0, 4000),
  };
}

/** Every search document of a snapshot, in region-id order. */
export async function buildDocuments(snapshot, options = {}) {
  const ctx = prepare(snapshot);
  const out = [];
  for (const r of [...snapshot.regions].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const d = await documentOf(ctx, r.id, options);
    if (d) out.push(d);
  }
  return out;
}
