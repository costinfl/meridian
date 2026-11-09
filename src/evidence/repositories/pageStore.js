import { newId, nowIso } from "../ids.js";
import { EvidenceError, invalid, notFound, pick, requireOneOf, requireString } from "../domain/errors.js";
import { WHOLE_PAGE_BOX, boxContains, normalizedBox, normalizedPolygon } from "../domain/box.js";

export const REGION_KINDS = ["page", "article", "block", "row", "cell", "line", "other"];
const PAGES = "evPages", REGIONS = "evRegions";
const ROTATIONS = [0, 90, 180, 270];

/**
 * Pages of a copy and the regions on them. Regions are citation targets, so they are never edited:
 * a wrong box is fixed with `correctRegion`, which adds a new region that supersedes the old one. Old
 * citations keep pointing at the old region (what was actually read); `currentRegion` resolves to the
 * newest version. A child region must lie inside its parent's box.
 */
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
      supersedesId: input.supersedesId ?? null,
      createdAt: nowIso(),
    };
  }

  /** Parent must exist, be on the same page, and contain the child's box. */
  async function checkParent(o, region) {
    if (!region.parentRegionId) return;
    const parent = await o.get(REGIONS, region.parentRegionId);
    if (!parent) throw notFound("Parent region", region.parentRegionId);
    if (parent.pageId !== region.pageId) throw invalid("a nested region must be on the same page as its parent");
    if (!boxContains(parent.box, region.box)) throw invalid("a nested region must lie inside its parent's box");
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
        await checkParent(o, region);
        await o.add(REGIONS, region);
      });
      return region;
    },
    /**
     * Fix a region's box (or polygon, label, kind) by adding a new region that supersedes it. Same page and
     * parent; the old region and everything that cites it stay as they were. A region can be superseded once.
     */
    async correctRegion(regionId, changes = {}) {
      let region;
      await storage.dbTransact([REGIONS], "readwrite", async (o) => {
        const old = await o.get(REGIONS, regionId);
        if (!old) throw notFound("Region", regionId);
        if (old.kind === "page") throw invalid("the whole-page region cannot be corrected");
        if ((await o.getAllByIndex(REGIONS, "bySupersedes", regionId)).length) throw new EvidenceError("conflict", "that region is already superseded; correct its latest version");
        region = makeRegion({
          box: changes.box ?? old.box, polygon: "polygon" in changes ? changes.polygon : old.polygon,
          kind: changes.kind ?? old.kind, label: changes.label ?? old.label,
          parentRegionId: old.parentRegionId, supersedesId: old.id,
        }, old.pageId);
        if (region.kind === "page") throw invalid("a corrected region cannot become the whole-page region");
        await checkParent(o, region);
        await o.add(REGIONS, region);
      });
      return region;
    },
    getRegion: (id) => storage.dbGet(REGIONS, id).then((r) => r ?? null),
    /** All regions of a page, including superseded versions. */
    listRegions: (pageId) => storage.dbGetAllByIndex(REGIONS, "byPage", pageId),
    /** Regions of a page that no later region supersedes. */
    async listCurrentRegions(pageId) {
      const all = await storage.dbGetAllByIndex(REGIONS, "byPage", pageId);
      const superseded = new Set(all.map((r) => r.supersedesId).filter(Boolean));
      return all.filter((r) => !superseded.has(r.id));
    },
    /** The newest version of a region (follows corrections forward); null if it does not exist. */
    async currentRegion(regionId) {
      let cur = await storage.dbGet(REGIONS, regionId);
      while (cur) {
        const next = (await storage.dbGetAllByIndex(REGIONS, "bySupersedes", cur.id))[0];
        if (!next) return cur;
        cur = next;
      }
      return null;
    },
    /** Versions of a region, oldest first, ending at the newest. */
    async regionHistory(regionId) {
      let head = await this.currentRegion(regionId);
      const chain = [];
      while (head && !chain.some((r) => r.id === head.id)) {
        chain.unshift(head);
        head = head.supersedesId ? await storage.dbGet(REGIONS, head.supersedesId) : null;
      }
      return chain;
    },
    /** Children of a region, including children recorded against its earlier versions. */
    async childRegions(regionId) {
      const versions = await this.regionHistory(regionId);
      const ids = versions.length ? versions.map((r) => r.id) : [regionId];
      return (await Promise.all(ids.map((id) => storage.dbGetAllByIndex(REGIONS, "byParent", id)))).flat();
    },
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
