import { newId, nowIso } from "../ids.js";
import { invalid, notFound, pick, requireOneOf, requireString } from "../domain/errors.js";
import { WHOLE_PAGE_BOX, normalizedBox, normalizedPolygon } from "../domain/box.js";

export const REGION_KINDS = ["page", "article", "block", "row", "cell", "line", "other"];
const PAGES = "evPages", REGIONS = "evRegions";
const ROTATIONS = [0, 90, 180, 270];

/** Pages of a copy and the regions on them. Regions are citation targets, so they are insert-only. */
export function createPageStore(storage) {
  function makeRegion(input, pageId) {
    return {
      id: newId(),
      pageId,
      box: normalizedBox(input.box),
      polygon: normalizedPolygon(input.polygon),
      kind: requireOneOf(input.kind ?? "block", REGION_KINDS, "kind"),
      label: input.label ?? "", // Title, Body, Caption...
      parentRegionId: input.parentRegionId ?? null,
      createdAt: nowIso(),
    };
  }

  return {
    /** Idempotent per (copyId, pageIndex). Creates the page and its whole-page region in one transaction. */
    async addPage({ copyId, pageIndex, label = "", width, height, rotation = 0, imageHash = null } = {}) {
      if (!Number.isInteger(pageIndex) || pageIndex < 0) throw invalid("pageIndex must be an integer >= 0");
      if (!(width > 0) || !(height > 0)) throw invalid("width and height must be positive");
      requireOneOf(rotation, ROTATIONS, "rotation");
      let out;
      await storage.dbTransact([PAGES, REGIONS, "evCopies"], "readwrite", async (o) => {
        if (!(await o.get("evCopies", copyId))) throw notFound("DigitalCopy", copyId);
        const existing = await o.getByIndex(PAGES, "byCopyIndex", [copyId, pageIndex]);
        if (existing) {
          const whole = (await o.getAllByIndex(REGIONS, "byPage", existing.id)).find((r) => r.kind === "page" && !r.parentRegionId);
          out = { page: existing, wholePageRegion: whole ?? null, created: false };
          return;
        }
        const page = { id: newId(), copyId, pageIndex, label, width, height, rotation, imageHash, createdAt: nowIso() };
        page.updatedAt = page.createdAt;
        const whole = makeRegion({ box: WHOLE_PAGE_BOX, kind: "page", label: "Whole page" }, page.id);
        await o.add(PAGES, page);
        await o.add(REGIONS, whole);
        out = { page, wholePageRegion: whole, created: true };
      });
      return out;
    },
    getPage: (id) => storage.dbGet(PAGES, id).then((r) => r ?? null),
    async listPages(copyId) {
      return (await storage.dbGetAllByIndex(PAGES, "byCopy", copyId)).sort((a, b) => a.pageIndex - b.pageIndex);
    },
    /** The printed folio label and display rotation can be corrected; size and position cannot. */
    async updatePage(id, patch) {
      const cur = await storage.dbGet(PAGES, id);
      if (!cur) throw notFound("Page", id);
      const next = { ...cur, ...pick(patch, ["label", "rotation"]), updatedAt: nowIso() };
      requireOneOf(next.rotation, ROTATIONS, "rotation");
      await storage.dbPut(PAGES, next);
      return next;
    },

    async addRegion(input = {}) {
      requireString(input.pageId, "pageId");
      let region;
      await storage.dbTransact([PAGES, REGIONS], "readwrite", async (o) => {
        if (!(await o.get(PAGES, input.pageId))) throw notFound("Page", input.pageId);
        region = makeRegion(input, input.pageId);
        if (region.kind === "page") throw invalid("the whole-page region is created with the page");
        if (region.parentRegionId) {
          const parent = await o.get(REGIONS, region.parentRegionId);
          if (!parent) throw notFound("Parent region", region.parentRegionId);
          if (parent.pageId !== region.pageId) throw invalid("a nested region must be on the same page as its parent");
        }
        await o.add(REGIONS, region);
      });
      return region;
    },
    getRegion: (id) => storage.dbGet(REGIONS, id).then((r) => r ?? null),
    listRegions: (pageId) => storage.dbGetAllByIndex(REGIONS, "byPage", pageId),
    childRegions: (parentRegionId) => storage.dbGetAllByIndex(REGIONS, "byParent", parentRegionId),
    async wholePageRegion(pageId) {
      return (await storage.dbGetAllByIndex(REGIONS, "byPage", pageId)).find((r) => r.kind === "page") ?? null;
    },
    /** Region ids from the root (outermost) down to `regionId`. */
    async regionPath(regionId) {
      const path = [];
      let cur = await storage.dbGet(REGIONS, regionId);
      while (cur) {
        path.unshift(cur);
        cur = cur.parentRegionId ? await storage.dbGet(REGIONS, cur.parentRegionId) : null;
      }
      return path;
    },
  };
}
