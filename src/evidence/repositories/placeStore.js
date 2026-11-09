import { newId, nowIso } from "../ids.js";
import { EvidenceError, invalid, notFound, pick, requireOneOf, requireString } from "../domain/errors.js";
import { dayRangeOf, intervalOf, intervalsOverlap, validDuring } from "../domain/validity.js";
import { searchKey } from "../domain/normalize.js";

export const PLACE_KINDS = ["settlement", "parish", "commune", "district", "county", "region", "country", "other"];
export const HIERARCHIES = ["civil", "church"];
const PLACES = "evPlaces", NAMES = "evPlaceNames", PARENTS = "evPlaceParents";

/**
 * Places, the names they carried over time, and where they sat in the civil and church hierarchies
 * over time. Queries take a `when`: ISO date ("1885-03-01"), FuzzyDate, day number or [fromDay, toDay].
 */
export function createPlaceStore(storage) {
  const checkCoords = (c) => {
    if (c == null) return null;
    if (!(c.lat >= -90 && c.lat <= 90 && c.lon >= -180 && c.lon <= 180)) throw invalid("coordinates must be { lat, lon } in range");
    return { lat: c.lat, lon: c.lon };
  };

  /** Parent edges of `placeId` in `hierarchy`, optionally only those valid during `range`. */
  async function parentEdges(o, placeId, hierarchy, range) {
    const edges = (await o.getAllByIndex(PARENTS, "byChild", placeId)).filter((e) => e.hierarchy === hierarchy);
    return range ? edges.filter((e) => validDuring(e, range)) : edges;
  }

  return {
    async createPlace({ kind = "settlement", coordinates = null, geonamesId = null, wikidataId = null } = {}) {
      const now = nowIso();
      const place = { id: newId(), kind: requireOneOf(kind, PLACE_KINDS, "kind"), coordinates: checkCoords(coordinates), geonamesId, wikidataId, createdAt: now, updatedAt: now };
      await storage.dbAdd(PLACES, place);
      return place;
    },
    getPlace: (id) => storage.dbGet(PLACES, id).then((r) => r ?? null),
    listPlaces: () => storage.dbGetAll(PLACES),
    async updatePlace(id, patch) {
      const cur = await storage.dbGet(PLACES, id);
      if (!cur) throw notFound("Place", id);
      const next = { ...cur, ...pick(patch, ["kind", "coordinates", "geonamesId", "wikidataId"]), updatedAt: nowIso() };
      requireOneOf(next.kind, PLACE_KINDS, "kind"); next.coordinates = checkCoords(next.coordinates);
      await storage.dbPut(PLACES, next);
      return next;
    },

    /* ---- names ---- */
    async addName({ placeId, name, language = "", validFrom = null, validTo = null } = {}) {
      const rec = { id: newId(), placeId, name: requireString(name, "name"), nameKey: searchKey(name), language, ...intervalOf(validFrom, validTo), createdAt: nowIso() };
      await storage.dbTransact([NAMES, PLACES], "readwrite", async (o) => {
        if (!(await o.get(PLACES, placeId))) throw notFound("Place", placeId);
        await o.add(NAMES, rec);
      });
      return rec;
    },
    async updateName(id, patch) {
      let out;
      await storage.dbTransact([NAMES], "readwrite", async (o) => {
        const cur = await o.get(NAMES, id);
        if (!cur) throw notFound("PlaceName", id);
        const next = { ...cur, ...pick(patch, ["name", "language", "validFrom", "validTo"]) };
        next.name = requireString(next.name, "name"); next.nameKey = searchKey(next.name);
        Object.assign(next, intervalOf(next.validFrom, next.validTo));
        await o.put(NAMES, next);
        out = next;
      });
      return out;
    },
    namesOf: (placeId) => storage.dbGetAllByIndex(NAMES, "byPlace", placeId),
    /** Names valid at `when`, preferred language first when given. */
    async namesAt(placeId, when, { language } = {}) {
      const range = dayRangeOf(when);
      const names = (await storage.dbGetAllByIndex(NAMES, "byPlace", placeId)).filter((n) => validDuring(n, range));
      return names.sort((a, b) => (language ? (b.language === language) - (a.language === language) : 0) || a.name.localeCompare(b.name));
    },
    async nameAt(placeId, when, opts) {
      return (await this.namesAt(placeId, when, opts))[0] ?? null;
    },
    /** Places that carried this name (accent- and case-insensitive) at any time, or at `when` if given. */
    async findByName(text, when) {
      const hits = await storage.dbGetAllByIndex(NAMES, "byNameKey", searchKey(text));
      const range = when == null ? null : dayRangeOf(when);
      const ids = [...new Set(hits.filter((n) => !range || validDuring(n, range)).map((n) => n.placeId))];
      return (await Promise.all(ids.map((id) => storage.dbGet(PLACES, id)))).filter(Boolean);
    },

    /* ---- hierarchy ---- */
    async addParent({ childId, parentId, hierarchy = "civil", validFrom = null, validTo = null } = {}) {
      requireOneOf(hierarchy, HIERARCHIES, "hierarchy");
      if (childId === parentId) throw invalid("a place cannot be its own parent");
      const edge = { id: newId(), childId, parentId, hierarchy, ...intervalOf(validFrom, validTo), createdAt: nowIso() };
      await storage.dbTransact([PARENTS, PLACES], "readwrite", async (o) => {
        if (!(await o.get(PLACES, childId))) throw notFound("Place", childId);
        if (!(await o.get(PLACES, parentId))) throw notFound("Place", parentId);
        // one parent per child, hierarchy and moment
        for (const e of await parentEdges(o, childId, hierarchy)) {
          if (intervalsOverlap(e, edge)) throw new EvidenceError("conflict", `place already has a ${hierarchy} parent during that period`);
        }
        // no cycles: the child must not already be an ancestor of the new parent during the period
        const range = [edge.fromDay, edge.toDay];
        const seen = new Set([parentId]);
        const stack = [parentId];
        while (stack.length) {
          const cur = stack.pop();
          for (const e of await parentEdges(o, cur, hierarchy, range)) {
            if (e.parentId === childId) throw new EvidenceError("invariant", "hierarchy would contain a cycle");
            if (!seen.has(e.parentId)) { seen.add(e.parentId); stack.push(e.parentId); }
          }
        }
        await o.add(PARENTS, edge);
      });
      return edge;
    },
    parentEdgesOf: (childId) => storage.dbGetAllByIndex(PARENTS, "byChild", childId),
    /** The parent place at `when` (null if none). */
    async parentAt(placeId, when, hierarchy = "civil") {
      const range = dayRangeOf(when);
      const edge = (await storage.dbGetAllByIndex(PARENTS, "byChild", placeId)).find((e) => e.hierarchy === hierarchy && validDuring(e, range));
      return edge ? (await storage.dbGet(PLACES, edge.parentId)) ?? null : null;
    },
    /** Parent chain at `when`, nearest first. */
    async ancestorsAt(placeId, when, hierarchy = "civil") {
      const out = [], seen = new Set([placeId]);
      let cur = placeId;
      for (;;) {
        const parent = await this.parentAt(cur, when, hierarchy);
        if (!parent || seen.has(parent.id)) break;
        out.push(parent); seen.add(parent.id); cur = parent.id;
      }
      return out;
    },
    /** Places directly below `placeId` at `when`. */
    async childrenAt(placeId, when, hierarchy = "civil") {
      const range = dayRangeOf(when);
      const edges = (await storage.dbGetAllByIndex(PARENTS, "byParent", placeId)).filter((e) => e.hierarchy === hierarchy && validDuring(e, range));
      return (await Promise.all(edges.map((e) => storage.dbGet(PLACES, e.childId)))).filter(Boolean);
    },
  };
}
