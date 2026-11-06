import { describe, it, expect, beforeEach } from "vitest";
import { freshStorage } from "./evidenceHelpers.js";
import { createCopyStore } from "../evidence/repositories/copyStore.js";
import { createPageStore } from "../evidence/repositories/pageStore.js";
import { normalizedBox, normalizedPolygon, boxFromPixels, boxContains, WHOLE_PAGE_BOX } from "../evidence/domain/box.js";

let storage, copies, pages, copy;
beforeEach(async () => {
  storage = freshStorage();
  copies = createCopyStore(storage); pages = createPageStore(storage);
  copy = (await copies.registerFile(new TextEncoder().encode("pdf"), { storage: { mode: "blob", blobKey: "k" } })).copy;
});

describe("normalizedBox (I4)", () => {
  it("accepts valid boxes including the whole page", () => {
    expect(normalizedBox({ x0: 0, y0: 0, x1: 1, y1: 1 })).toEqual(WHOLE_PAGE_BOX);
    expect(normalizedBox({ x0: 0.1, y0: 0.2, x1: 0.5, y1: 0.9 })).toEqual({ x0: 0.1, y0: 0.2, x1: 0.5, y1: 0.9 });
  });
  it.each([
    [{ x0: -0.1, y0: 0, x1: 1, y1: 1 }], [{ x0: 0, y0: 0, x1: 1.0001, y1: 1 }],
    [{ x0: 0.5, y0: 0, x1: 0.5, y1: 1 }], [{ x0: 0.6, y0: 0, x1: 0.4, y1: 1 }],
    [{ x0: 0, y0: 0.9, x1: 1, y1: 0.1 }], [{ x0: 0, y0: 0, x1: 1 }],
    [{ x0: NaN, y0: 0, x1: 1, y1: 1 }], [{ x0: "0", y0: 0, x1: 1, y1: 1 }], [null], [undefined],
  ])("rejects invalid box %j", (box) => {
    expect(() => normalizedBox(box)).toThrow(/box/);
  });
  it("validates polygons", () => {
    expect(normalizedPolygon(null)).toBeNull();
    expect(normalizedPolygon([[0, 0], [1, 0], [0.5, 1]])).toHaveLength(3);
    expect(() => normalizedPolygon([[0, 0], [1, 1]])).toThrow(/3 points/);
    expect(() => normalizedPolygon([[0, 0], [1, 1], [2, 0]])).toThrow(/point 2/);
  });
  it("converts pixel rectangles on the unrotated image", () => {
    expect(boxFromPixels({ x: 100, y: 200, w: 300, h: 400 }, 1000, 2000)).toEqual({ x0: 0.1, y0: 0.1, x1: 0.4, y1: 0.3 });
    expect(() => boxFromPixels({ x: 900, y: 0, w: 200, h: 10 }, 1000, 2000)).toThrow(/box/);
    expect(boxContains({ x0: 0, y0: 0, x1: 1, y1: 1 }, { x0: 0.2, y0: 0.2, x1: 0.3, y1: 0.3 })).toBe(true);
  });
});

describe("Page store", () => {
  it("adds a page with an automatic whole-page region, idempotently per (copy, pageIndex)", async () => {
    const r1 = await pages.addPage({ copyId: copy.id, pageIndex: 0, label: "f. 23v", width: 1200, height: 1700 });
    expect(r1.created).toBe(true);
    expect(r1.wholePageRegion).toMatchObject({ pageId: r1.page.id, kind: "page", box: WHOLE_PAGE_BOX, parentRegionId: null });
    const r2 = await pages.addPage({ copyId: copy.id, pageIndex: 0, width: 1200, height: 1700 });
    expect(r2.created).toBe(false);
    expect(r2.page.id).toBe(r1.page.id);
    expect(r2.wholePageRegion.id).toBe(r1.wholePageRegion.id);
    expect(await storage.dbCount("evPages")).toBe(1);
    expect(await storage.dbCount("evRegions")).toBe(1);
  });

  it("lists pages in order and validates input", async () => {
    await pages.addPage({ copyId: copy.id, pageIndex: 2, width: 10, height: 10 });
    await pages.addPage({ copyId: copy.id, pageIndex: 0, width: 10, height: 10 });
    await pages.addPage({ copyId: copy.id, pageIndex: 1, width: 10, height: 10 });
    expect((await pages.listPages(copy.id)).map((p) => p.pageIndex)).toEqual([0, 1, 2]);
    await expect(pages.addPage({ copyId: copy.id, pageIndex: -1, width: 1, height: 1 })).rejects.toMatchObject({ code: "invalid" });
    await expect(pages.addPage({ copyId: copy.id, pageIndex: 5, width: 0, height: 1 })).rejects.toMatchObject({ code: "invalid" });
    await expect(pages.addPage({ copyId: copy.id, pageIndex: 5, width: 1, height: 1, rotation: 45 })).rejects.toMatchObject({ code: "invalid" });
    await expect(pages.addPage({ copyId: "missing", pageIndex: 0, width: 1, height: 1 })).rejects.toMatchObject({ code: "not-found" });
  });

  it("updates only label and rotation of a page", async () => {
    const { page } = await pages.addPage({ copyId: copy.id, pageIndex: 0, width: 100, height: 200 });
    const u = await pages.updatePage(page.id, { label: "p. 5", rotation: 90, width: 1, copyId: "x" });
    expect(u).toMatchObject({ label: "p. 5", rotation: 90, width: 100, copyId: copy.id });
    await expect(pages.updatePage(page.id, { rotation: 10 })).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("Region store", () => {
  it("nests regions: page -> article -> blocks; path and children work", async () => {
    const { page, wholePageRegion } = await pages.addPage({ copyId: copy.id, pageIndex: 0, width: 100, height: 100 });
    const article = await pages.addRegion({ pageId: page.id, box: { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.6 }, kind: "article", label: "Article" });
    const title = await pages.addRegion({ pageId: page.id, box: { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.2 }, kind: "block", label: "Title", parentRegionId: article.id });
    const body = await pages.addRegion({ pageId: page.id, box: { x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.6 }, kind: "block", label: "Body", parentRegionId: article.id });
    expect((await pages.childRegions(article.id)).map((r) => r.label).sort()).toEqual(["Body", "Title"]);
    expect((await pages.regionPath(body.id)).map((r) => r.id)).toEqual([article.id, body.id]);
    expect((await pages.listRegions(page.id)).map((r) => r.id).sort()).toEqual([wholePageRegion.id, article.id, title.id, body.id].sort());
    expect((await pages.wholePageRegion(page.id)).id).toBe(wholePageRegion.id);
  });

  it("rejects invalid boxes, a second whole-page region, missing page/parent, and cross-page nesting", async () => {
    const { page } = await pages.addPage({ copyId: copy.id, pageIndex: 0, width: 100, height: 100 });
    const other = await pages.addPage({ copyId: copy.id, pageIndex: 1, width: 100, height: 100 });
    const ok = { x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.2 };
    await expect(pages.addRegion({ pageId: page.id, box: { x0: 0.5, y0: 0, x1: 0.2, y1: 1 } })).rejects.toMatchObject({ code: "invalid" });
    await expect(pages.addRegion({ pageId: page.id, box: { x0: 0, y0: 0, x1: 2, y1: 1 } })).rejects.toMatchObject({ code: "invalid" });
    await expect(pages.addRegion({ pageId: page.id, box: ok, kind: "page" })).rejects.toMatchObject({ code: "invalid" });
    await expect(pages.addRegion({ pageId: page.id, box: ok, kind: "bogus" })).rejects.toMatchObject({ code: "invalid" });
    await expect(pages.addRegion({ pageId: "missing", box: ok })).rejects.toMatchObject({ code: "not-found" });
    await expect(pages.addRegion({ pageId: page.id, box: ok, parentRegionId: "missing" })).rejects.toMatchObject({ code: "not-found" });
    const parentOnOther = other.wholePageRegion;
    await expect(pages.addRegion({ pageId: page.id, box: ok, parentRegionId: parentOnOther.id })).rejects.toMatchObject({ code: "invalid" });
    expect(await storage.dbCount("evRegions")).toBe(2); // only the two whole-page regions
  });

  it("stores polygons and exposes no update or delete for regions (citation targets are stable)", async () => {
    const { page } = await pages.addPage({ copyId: copy.id, pageIndex: 0, width: 100, height: 100 });
    const r = await pages.addRegion({ pageId: page.id, box: { x0: 0, y0: 0, x1: 0.5, y1: 0.5 }, polygon: [[0, 0], [0.5, 0], [0.25, 0.5]], kind: "article" });
    expect((await pages.getRegion(r.id)).polygon).toEqual([[0, 0], [0.5, 0], [0.25, 0.5]]);
    const names = Object.keys(pages).filter((k) => /region/i.test(k));
    expect(names.filter((k) => /^(update|delete|remove|set|put)/i.test(k))).toEqual([]);
  });
});
