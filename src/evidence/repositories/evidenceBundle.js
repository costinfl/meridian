import { newId } from "../ids.js";
import { invalid } from "../domain/errors.js";

/*
 * Evidence in a native bundle (`evidence.json`, bundle v2; ADR-0001/0002 extended).
 *   collect(seeds)  the library entities a project references: its seed sources / personas / assertions /
 *                   copies plus everything they depend on (closure), with no raw outputs and no page cache.
 *   merge(data)     import into the shared library in ONE transaction: nothing existing is overwritten; entities
 *                   are matched by id, DigitalCopies by content hash (their pages and regions are remapped onto
 *                   the existing copy). Returns what was added/skipped and the id maps the project needs.
 * Only library data is written: no settings, API keys or folder handles (I9). Scale assumption: the whole
 * library is read into memory for the closure; fine for personal-research volumes (revisit with Phase 7).
 */

export const EVIDENCE_FORMAT = "meridian-evidence";
export const EVIDENCE_VERSION = 1;

const ENTITY_STORES = {
  repositories: "evRepositories", sources: "evSources", copies: "evCopies", pages: "evPages", regions: "evRegions",
  runs: "evRuns", textLayers: "evTextLayers", records: "evRecords", personas: "evPersonas", assertions: "evAssertions",
  assertionDecisions: "evAssertionDecisions", places: "evPlaces", placeNames: "evPlaceNames", placeParents: "evPlaceParents",
  nameVariants: "evNameVariants",
};
const KEYS = Object.keys(ENTITY_STORES);
const ALL_STORES = Object.values(ENTITY_STORES);

export function validateBundleData(data) {
  if (!data || typeof data !== "object") throw invalid("evidence.json is not an object");
  if (data.format !== EVIDENCE_FORMAT) throw invalid(`evidence.json: unknown format '${data.format}'`);
  if (data.version !== EVIDENCE_VERSION) throw invalid(`evidence.json: unsupported version ${data.version}`);
  for (const k of KEYS) {
    const rows = data[k] ?? [];
    if (!Array.isArray(rows)) throw invalid(`evidence.json: ${k} must be an array`);
    for (const r of rows) if (!r || typeof r.id !== "string" || !r.id) throw invalid(`evidence.json: a row in ${k} has no id`);
  }
  return data;
}

export function createEvidenceBundle(storage) {
  return {
    /** @param {{ sourceIds?: string[], copyIds?: string[], personaIds?: string[], assertionIds?: string[] }} seeds */
    async collect(seeds = {}) {
      const all = await storage.dbTransact(ALL_STORES, "readonly", async (o) => {
        const out = {};
        for (const k of KEYS) out[k] = await o.getAll(ENTITY_STORES[k]);
        return out;
      });
      const index = Object.fromEntries(KEYS.map((k) => [k, new Map(all[k].map((r) => [r.id, r]))]));
      const take = Object.fromEntries(KEYS.map((k) => [k, new Set()]));
      const group = (rows, field) => { const m = new Map(); for (const r of rows) { const v = r[field]; if (v != null) m.set(v, [...(m.get(v) ?? []), r]); } return m; };
      const assertionsBySubject = group(all.assertions, "subjectId"), assertionsByObject = group(all.assertions, "objectPersonaId");
      const personasByRecord = group(all.personas, "recordId"), pagesByCopy = group(all.pages, "copyId");
      const layersByRegion = group(all.textLayers, "regionId"), copiesBySource = group(all.copies, "sourceId");
      const namesByPlace = group(all.placeNames, "placeId"), edgesByChild = group(all.placeParents, "childId");
      const regionsByPage = group(all.regions, "pageId");

      const mark = (k, id) => { if (id == null || take[k].has(id) || !index[k].has(id)) return false; take[k].add(id); return true; };
      const addRepository = (id) => mark("repositories", id);
      const addRun = (id) => mark("runs", id);
      const addSource = (id, { withCopies = false } = {}) => {
        const fresh = mark("sources", id);
        const s = index.sources.get(id);
        if (fresh && s) { addRepository(s.repositoryId); addSource(s.parentSourceId); }
        if (s && withCopies) for (const c of copiesBySource.get(id) ?? []) addCopy(c.id);
      };
      const addCopy = (id) => {
        if (!mark("copies", id)) return;
        const c = index.copies.get(id);
        addSource(c.sourceId); addCopy(c.supersededByCopyId);
      };
      const addPlace = (id) => {
        if (!mark("places", id)) return;
        for (const n of namesByPlace.get(id) ?? []) take.placeNames.add(n.id);
        for (const e of edgesByChild.get(id) ?? []) { take.placeParents.add(e.id); addPlace(e.parentId); }
      };
      const addPage = (id) => {
        if (!mark("pages", id)) return;
        const p = index.pages.get(id);
        addCopy(p.copyId);
        for (const r of regionsByPage.get(id) ?? []) if (r.kind === "page") addRegion(r.id);
      };
      const addRegion = (id) => {
        if (!mark("regions", id)) return;
        const r = index.regions.get(id);
        addPage(r.pageId); addRegion(r.parentRegionId); addRegion(r.supersedesId);
      };
      const addRecord = (id) => {
        if (!mark("records", id)) return;
        const r = index.records.get(id);
        for (const rid of r.regionIds ?? []) addRegion(rid);
        addRun(r.runId); addPlace(r.placeId);
        for (const p of personasByRecord.get(id) ?? []) addPersona(p.id);
      };
      const addPersona = (id) => {
        if (!mark("personas", id)) return;
        const p = index.personas.get(id);
        addRecord(p.recordId); addRegion(p.regionId); addPlace(p.residencePlaceId);
        for (const a of [...(assertionsBySubject.get(id) ?? []), ...(assertionsByObject.get(id) ?? [])]) addAssertion(a.id);
      };
      const addAssertion = (id) => {
        if (!mark("assertions", id)) return;
        const a = index.assertions.get(id);
        if (a.subjectType === "record") addRecord(a.subjectId); else addPersona(a.subjectId);
        addPersona(a.objectPersonaId); addRegion(a.citation?.regionId); addSource(a.citation?.sourceId);
        addRun(a.runId); addAssertion(a.supersedesId);
      };

      for (const id of seeds.sourceIds ?? []) addSource(id, { withCopies: true });
      for (const id of seeds.copyIds ?? []) addCopy(id);
      for (const id of seeds.personaIds ?? []) addPersona(id);
      for (const id of seeds.assertionIds ?? []) addAssertion(id);
      // text read from the included regions, and the decisions on the included assertions
      for (const rid of [...take.regions]) for (const t of layersByRegion.get(rid) ?? []) { take.textLayers.add(t.id); addRun(t.runId); }
      for (const d of all.assertionDecisions) if (take.assertions.has(d.assertionId)) take.assertionDecisions.add(d.id);
      // name variants are small, user-entered reference data: always included
      for (const v of all.nameVariants) take.nameVariants.add(v.id);

      const data = { format: EVIDENCE_FORMAT, version: EVIDENCE_VERSION, exportedAt: new Date().toISOString() };
      for (const k of KEYS) data[k] = [...take[k]].sort().map((id) => index[k].get(id));
      data.counts = Object.fromEntries(KEYS.map((k) => [k, data[k].length]));
      return data;
    },

    async merge(input) {
      const data = validateBundleData(input);
      const rows = (k) => data[k] ?? [];
      const added = Object.fromEntries(KEYS.map((k) => [k, 0])), skipped = Object.fromEntries(KEYS.map((k) => [k, 0]));
      const warnings = [];
      const maps = { copy: {}, page: {}, region: {}, repository: {} };

      await storage.dbTransact(ALL_STORES, "readwrite", async (o) => {
        const put = async (k, row) => { await o.add(ENTITY_STORES[k], row); added[k]++; };
        const has = async (k, id) => !!(await o.get(ENTITY_STORES[k], id));
        const idFree = async (k, id) => ((await has(k, id)) ? newId() : id);

        // repositories: by id, else reuse one with the same name
        const existingRepos = await o.getAll("evRepositories");
        for (const r of rows("repositories")) {
          const byId = existingRepos.find((x) => x.id === r.id);
          const byName = existingRepos.find((x) => String(x.name).toLowerCase() === String(r.name).toLowerCase());
          const hit = byId ?? byName;
          if (hit) { maps.repository[r.id] = hit.id; skipped.repositories++; continue; }
          await put("repositories", r); existingRepos.push(r);
        }
        const repo = (id) => (id == null ? null : maps.repository[id] ?? id);

        // sources: parents first; never overwrite
        const pending = [...rows("sources")], doneSources = new Set();
        for (let guard = 0; pending.length && guard < 1000; guard++) {
          const s = pending.shift();
          const parentPending = s.parentSourceId && pending.some((x) => x.id === s.parentSourceId);
          if (parentPending) { pending.push(s); continue; }
          if (await has("sources", s.id)) { skipped.sources++; doneSources.add(s.id); continue; }
          let parent = s.parentSourceId ?? null;
          if (parent && !(await has("sources", parent))) { warnings.push(`source "${s.title}": parent not found, imported without it`); parent = null; }
          await put("sources", { ...s, repositoryId: repo(s.repositoryId), parentSourceId: parent }); doneSources.add(s.id);
        }
        const sourceOk = async (id) => (id && (await has("sources", id)) ? id : null);

        // copies: identity is the content hash
        const insertedCopies = new Map(); // final id -> imported copy
        for (const c of rows("copies")) {
          const same = await o.getByIndex("evCopies", "bySha256", c.sha256);
          if (same) { maps.copy[c.id] = same.id; skipped.copies++; continue; }
          const id = await idFree("copies", c.id);
          maps.copy[c.id] = id;
          await put("copies", { ...c, id, sourceId: await sourceOk(c.sourceId), possibleDuplicateOf: [], duplicateResolution: null, supersededByCopyId: null });
          insertedCopies.set(id, c);
        }
        for (const [id, c] of insertedCopies) { // superseded pointers, now that every copy has its final id
          const target = c.supersededByCopyId ? maps.copy[c.supersededByCopyId] : null;
          if (target && target !== id) await o.put("evCopies", { ...(await o.get("evCopies", id)), supersededByCopyId: target });
        }

        // pages: unique per (copy, index)
        for (const p of rows("pages")) {
          const copyId = maps.copy[p.copyId] ?? p.copyId;
          const same = await o.getByIndex("evPages", "byCopyIndex", [copyId, p.pageIndex]);
          if (same) { maps.page[p.id] = same.id; skipped.pages++; continue; }
          const id = await idFree("pages", p.id);
          maps.page[p.id] = id;
          await put("pages", { ...p, id, copyId });
        }

        // regions: parents and predecessors first; a whole-page region maps onto the existing page's
        let rest = [...rows("regions")];
        for (let guard = 0; rest.length && guard < 1000; guard++) {
          const next = [];
          let progressed = false;
          for (const r of rest) {
            const waiting = [r.parentRegionId, r.supersedesId].some((x) => x && !maps.region[x] && rest.some((y) => y.id === x));
            if (waiting) { next.push(r); continue; }
            progressed = true;
            const pageId = maps.page[r.pageId] ?? r.pageId;
            if (r.kind === "page") {
              const whole = (await o.getAllByIndex("evRegions", "byPage", pageId)).find((x) => x.kind === "page");
              if (whole) { maps.region[r.id] = whole.id; skipped.regions++; continue; }
            }
            const sameId = await o.get("evRegions", r.id);
            if (sameId) { maps.region[r.id] = sameId.id; skipped.regions++; continue; }
            const id = await idFree("regions", r.id);
            maps.region[r.id] = id;
            await put("regions", { ...r, id, pageId, parentRegionId: r.parentRegionId ? maps.region[r.parentRegionId] ?? null : null, supersedesId: r.supersedesId ? maps.region[r.supersedesId] ?? null : null });
          }
          rest = next;
          if (!progressed) { for (const r of rest) warnings.push(`region ${r.id}: parent or predecessor missing, skipped`); skipped.regions += rest.length; break; }
        }
        const region = (id) => (id == null ? null : maps.region[id] ?? (id));

        for (const r of rows("runs")) { if (await has("runs", r.id)) skipped.runs++; else await put("runs", r); }
        for (const t of rows("textLayers")) {
          if (await has("textLayers", t.id)) { skipped.textLayers++; continue; }
          if (!(await o.get("evRegions", region(t.regionId)))) { warnings.push(`text layer ${t.id}: region missing, skipped`); skipped.textLayers++; continue; }
          await put("textLayers", { ...t, regionId: region(t.regionId) });
        }

        for (const p of rows("places")) { if (await has("places", p.id)) skipped.places++; else await put("places", p); }
        for (const n of rows("placeNames")) { if (await has("placeNames", n.id)) skipped.placeNames++; else await put("placeNames", n); }
        for (const e of rows("placeParents")) {
          if (await has("placeParents", e.id)) { skipped.placeParents++; continue; }
          const clash = (await o.getAllByIndex("evPlaceParents", "byChild", e.childId)).some((x) => x.hierarchy === e.hierarchy && x.fromDay <= e.toDay && e.fromDay <= x.toDay);
          if (clash) { warnings.push("a place hierarchy edge overlaps an existing one and was skipped"); skipped.placeParents++; continue; }
          await put("placeParents", e);
        }

        for (const r of rows("records")) {
          if (await has("records", r.id)) { skipped.records++; continue; }
          await put("records", { ...r, regionIds: (r.regionIds ?? []).map(region) });
        }
        for (const p of rows("personas")) {
          if (await has("personas", p.id)) { skipped.personas++; continue; }
          await put("personas", { ...p, regionId: region(p.regionId) });
        }
        const newAssertions = new Set();
        for (const a of rows("assertions")) {
          if (await has("assertions", a.id)) { skipped.assertions++; continue; }
          await put("assertions", { ...a, citation: { ...a.citation, regionId: region(a.citation?.regionId) }, citationRegionId: region(a.citationRegionId) });
          newAssertions.add(a.id);
        }
        for (const d of rows("assertionDecisions")) { // only for assertions this import added: the library's own decisions win
          if (!newAssertions.has(d.assertionId) || (await o.getByIndex("evAssertionDecisions", "byAssertion", d.assertionId)) || (await has("assertionDecisions", d.id))) { skipped.assertionDecisions++; continue; }
          await put("assertionDecisions", d);
        }
        const variants = await o.getAll("evNameVariants");
        for (const v of rows("nameVariants")) {
          if (variants.some((x) => x.id === v.id || (x.canonicalKey === v.canonicalKey && x.variantKey === v.variantKey))) { skipped.nameVariants++; continue; }
          await put("nameVariants", v); variants.push(v);
        }
      });
      return { added, skipped, warnings, maps };
    },
  };
}
