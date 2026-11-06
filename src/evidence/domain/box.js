import { invalid } from "./errors.js";

// Invariant I4: region boxes are normalised to 0-1 in the UNROTATED page image.
// Processor-specific coordinates are converted once, on import; originals stay in the raw output.

const inUnit = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

/** Validate and return a plain { x0, y0, x1, y1 } with 0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1. */
export function normalizedBox(box) {
  if (!box || typeof box !== "object") throw invalid("box is required");
  const { x0, y0, x1, y1 } = box;
  for (const [k, v] of Object.entries({ x0, y0, x1, y1 })) {
    if (!inUnit(v)) throw invalid(`box.${k} must be a number between 0 and 1`);
  }
  if (!(x0 < x1)) throw invalid("box requires x0 < x1");
  if (!(y0 < y1)) throw invalid("box requires y0 < y1");
  return { x0, y0, x1, y1 };
}

/** Optional polygon: at least 3 points, each [x, y] within 0-1. */
export function normalizedPolygon(points) {
  if (points == null) return null;
  if (!Array.isArray(points) || points.length < 3) throw invalid("polygon needs at least 3 points");
  return points.map((p, i) => {
    if (!Array.isArray(p) || p.length !== 2 || !inUnit(p[0]) || !inUnit(p[1])) throw invalid(`polygon point ${i} must be [x, y] within 0-1`);
    return [p[0], p[1]];
  });
}

export const WHOLE_PAGE_BOX = Object.freeze({ x0: 0, y0: 0, x1: 1, y1: 1 });

/** Convert a pixel rectangle {x, y, w, h} measured on the unrotated page image (width x height) to a normalised box. */
export function boxFromPixels({ x, y, w, h }, width, height) {
  if (!(width > 0) || !(height > 0)) throw invalid("page width and height must be positive");
  return normalizedBox({ x0: x / width, y0: y / height, x1: (x + w) / width, y1: (y + h) / height });
}

export function boxContains(outer, inner, eps = 1e-9) {
  return inner.x0 >= outer.x0 - eps && inner.y0 >= outer.y0 - eps && inner.x1 <= outer.x1 + eps && inner.y1 <= outer.y1 + eps;
}
