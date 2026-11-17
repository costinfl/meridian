import { buildDocuments, prepare, documentOf } from "./documents.js";
import { createIndex, serialize, deserialize, INDEX_SCHEMA_VERSION } from "./engine.js";

// Building, storing and loading the search index (P7.T1). The stored row (evSearchIndex, IndexedDB v6) is derived
// data: a full rebuild from the library always gives the same index (I7).

/**
 * What the index has seen, exactly: the latest timestamp in the snapshot it was built from (`mark`) and the keys
 * of the rows that carry exactly that timestamp (`atMark`). A row is new if its time is later than the mark, or
 * equal to it but not one of those rows. (Wall-clock milliseconds can repeat, so a time alone is not enough.)
 */
const STAMPED = [
  ["sources", (x) => x.updatedAt ?? x.createdAt], ["copies", (x) => x.updatedAt ?? x.createdAt], ["regions", (x) => x.createdAt],
  ["textLayers", (x) => x.createdAt], ["records", (x) => x.createdAt], ["personas", (x) => x.createdAt],
  ["assertions", (x) => x.createdAt], ["decisions", (x) => x.decidedAt], ["nameVariants", (x) => x.createdAt],
];
export function markOf(snapshot) {
  let mark = "";
  for (const [k, t] of STAMPED) for (const x of snapshot[k]) { const ts = t(x) ?? ""; if (ts > mark) mark = ts; }
  const atMark = [];
  for (const [k, t] of STAMPED) for (const x of snapshot[k]) if ((t(x) ?? "") === mark && mark) atMark.push(`${k}:${x.id}`);
  return { mark, atMark: atMark.sort() };
}
const isNewer = (seen, kind, row, ts) => !!ts && (ts > seen.mark || (ts === seen.mark && !seen.atMarkSet.has(`${kind}:${row.id}`)));

const placeAncestorsOf = (library) => (placeId, when) => library.places.ancestorsAt(placeId, when ?? null).catch(() => []);
const nowIso = () => new Date().toISOString();

/** Full rebuild from the stores. Returns { index, docCount, builtAt }. */
export async function buildIndex(library) {
  const builtAt = nowIso();
  const snapshot = await library.searchIndex.snapshot();
  const docs = await buildDocuments(snapshot, { placeAncestors: placeAncestorsOf(library) });
  const index = createIndex();
  index.addAll(docs);
  return { index, docCount: docs.length, builtAt, seen: markOf(snapshot) };
}

export async function saveIndex(library, { index, builtAt, seen }) {
  await library.searchIndex.put({ schemaVersion: INDEX_SCHEMA_VERSION, builtAt, seen, docCount: index.documentCount, json: serialize(index) });
}

/** The stored index, or null if there is none or it was made by an older index schema. */
export async function loadIndex(library) {
  const row = await library.searchIndex.get();
  if (!row || row.schemaVersion !== INDEX_SCHEMA_VERSION) return null;
  return { index: deserialize(row.json), docCount: row.docCount, builtAt: row.builtAt, seen: row.seen ?? { mark: "", atMark: [] } };
}

/** Rebuild and store. */
export async function rebuildIndex(library) {
  const built = await buildIndex(library);
  await saveIndex(library, built);
  return built;
}

/**
 * The regions whose search document may have changed since `since` (ISO time), or { full: true } when a change
 * touches documents in ways we do not track per region (name variants, source or copy details).
 */
export function changedRegions(snapshot, seen) {
  const s = { mark: seen?.mark ?? "", atMarkSet: new Set(seen?.atMark ?? []) };
  const stampOf = Object.fromEntries(STAMPED);
  const newer = (kind) => (x) => isNewer(s, kind, x, stampOf[kind](x));
  if (snapshot.nameVariants.some(newer("nameVariants"))) return { full: true, reason: "name variants changed" };
  let pageRegions = [];
  const newSources = new Set(snapshot.sources.filter(newer("sources")).map((x) => x.id));
  if (newSources.size || snapshot.copies.some(newer("copies"))) {
    // a new or changed source or copy changes the metadata of its pages' documents: re-do those pages
    const copies = new Set(snapshot.copies.filter((c) => newer("copies")(c) || newSources.has(c.sourceId)).map((c) => c.id));
    const pages = new Set(snapshot.pages.filter((p) => copies.has(p.copyId)).map((p) => p.id));
    pageRegions = snapshot.regions.filter((r) => pages.has(r.pageId)).map((r) => r.id);
  }
  const ids = new Set(pageRegions);
  const recordById = new Map(snapshot.records.map((r) => [r.id, r]));
  const assertionById = new Map(snapshot.assertions.map((a) => [a.id, a]));
  const regionOfAssertion = (a) => a?.citationRegionId ?? a?.citation?.regionId ?? null;
  for (const l of snapshot.textLayers) if (newer("textLayers")(l)) ids.add(l.regionId);
  for (const r of snapshot.regions) if (newer("regions")(r)) { ids.add(r.id); if (r.supersedesId) ids.add(r.supersedesId); }
  for (const r of snapshot.records) if (newer("records")(r)) r.regionIds.forEach((id) => ids.add(id));
  for (const p of snapshot.personas) if (newer("personas")(p)) (recordById.get(p.recordId)?.regionIds ?? []).forEach((id) => ids.add(id));
  for (const a of snapshot.assertions) if (newer("assertions")(a)) {
    ids.add(regionOfAssertion(a));
    if (a.supersedesId) ids.add(regionOfAssertion(assertionById.get(a.supersedesId)));
  }
  for (const d of snapshot.decisions) if (newer("decisions")(d)) ids.add(regionOfAssertion(assertionById.get(d.assertionId)));
  ids.delete(null); ids.delete(undefined);
  return { full: false, regionIds: [...ids].sort() };
}

/**
 * Bring an index up to date with the stores (P7.T2): only the documents of regions changed since `state.builtAt`
 * are rebuilt (discard + add). The result answers every query like a full rebuild (I7, tested).
 * Returns { state, changed, full }.
 */
export async function updateIndex(library, state) {
  if (!state) { const built = await rebuildIndex(library); return { state: built, changed: built.docCount, full: true }; }
  const builtAt = nowIso();
  const snapshot = await library.searchIndex.snapshot();
  const seen = markOf(snapshot);
  const change = changedRegions(snapshot, state.seen);
  if (change.full) {
    const docs = await buildDocuments(snapshot, { placeAncestors: placeAncestorsOf(library) });
    const index = createIndex();
    index.addAll(docs);
    const next = { index, docCount: docs.length, builtAt, seen };
    await saveIndex(library, next);
    return { state: next, changed: docs.length, full: true };
  }
  if (!change.regionIds.length) return { state, changed: 0, full: false };
  const ctx = prepare(snapshot);
  const { index } = state;
  for (const id of change.regionIds) {
    if (index.has(id)) index.discard(id);
    const doc = await documentOf(ctx, id, { placeAncestors: placeAncestorsOf(library) });
    if (doc) index.add(doc);
  }
  const next = { index, docCount: index.documentCount, builtAt, seen };
  await saveIndex(library, next);
  return { state: next, changed: change.regionIds.length, full: false };
}
