import { searchKey, dmCodesOfName } from "../evidence/index.js";
import { toJdn } from "../evidence/domain/fuzzyDate.js";
import { variantMap } from "./documents.js";

// Queries (P7.T3). Every word of the query is looked up three ways, and a region matches when every word is
// found in at least one of them:
//   - as written: folded text and names, with prefix matching and, for longer words, fuzzy matching (OCR noise);
//   - name variants paired with it (ONE HOP: Ioan~Iohannes, never chained);
//   - its Daitch-Mokotoff codes (names that sound alike: Popescu ~ Popesku).
// Filters: years, place (and the places below it), source kind, scope (a set of source ids), confirmed only.

const MAX_RESULTS = 200;

/** Year range [from, to] as Julian Day Numbers (Gregorian calendar, whole years). */
function yearDays(from, to) {
  const a = Number.isInteger(from) ? toJdn(from, 1, 1, "gregorian") : -Infinity;
  const b = Number.isInteger(to) ? toJdn(to, 12, 31, "gregorian") : Infinity;
  return [a, b];
}

/** The query as a MiniSearch expression, plus what each word expands to (for explaining matches). */
export function expandQuery(q, vmap = new Map()) {
  const words = [...new Set(searchKey(q).split(" ").filter(Boolean))];
  const expansions = words.map((w) => {
    const variants = [...(vmap.get(w) ?? [])].filter((v) => v !== w);
    const dm = /^\d+$/.test(w) ? [] : dmCodesOfName(w);
    const parts = [{ queries: [w], fields: ["text", "names"], prefix: w.length >= 3, fuzzy: w.length >= 4 ? 0.2 : false }];
    if (variants.length) parts.push({ queries: variants, fields: ["names", "text"], boost: { names: 2, text: 1 } });
    if (dm.length) parts.push({ queries: dm, fields: ["dm"], boost: { dm: 0.6 } });
    return { word: w, variants, dm, expr: { combineWith: "OR", queries: parts } };
  });
  return { words, expansions, expr: expansions.length ? { combineWith: "AND", queries: expansions.map((e) => e.expr) } : null };
}

/** Why a hit matched, in words a researcher understands. */
function reasonsOf(hit, expansions) {
  const out = new Set();
  const terms = Object.keys(hit.match ?? {});
  // a word found as written does not also need "sounds like" (its own D-M code always matches itself)
  const direct = new Set(expansions.filter((e) => terms.some((t) => t === e.word || t.startsWith(e.word) || e.variants.includes(t))).map((e) => e.word));
  for (const [term, fields] of Object.entries(hit.match ?? {})) {
    for (const e of expansions) {
      if (fields.includes("dm") && e.dm.includes(term)) { if (!direct.has(e.word)) out.add(`sounds like “${e.word}”`); }
      else if (e.variants.includes(term)) out.add(`variant of “${e.word}”`);
      else if (term === e.word || term.startsWith(e.word)) out.add(fields.includes("names") ? "name" : "text");
      else if (!e.dm.includes(term) && (fields.includes("text") || fields.includes("names"))) out.add(`similar to “${e.word}”`);
    }
  }
  return [...out];
}

/**
 * A short piece of the region's own text around the first matched word: [{ text, hit }] segments.
 * Matching is done on folded words, the snippet keeps the original spelling.
 */
export function snippetOf(source, terms, { radius = 9 } = {}) {
  const text = String(source ?? "");
  const tokens = [...text.matchAll(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu)];
  const wanted = new Set(terms);
  const hitAt = (t) => { const k = searchKey(t[0]); return wanted.has(k) || [...wanted].some((w) => w.length >= 3 && k.startsWith(w)); };
  const first = tokens.findIndex(hitAt);
  if (first < 0) return text ? [{ text: text.slice(0, 160) + (text.length > 160 ? "…" : ""), hit: false }] : [];
  const lo = Math.max(0, first - radius), hi = Math.min(tokens.length - 1, first + radius * 2);
  const start = tokens[lo].index, end = tokens[hi].index + tokens[hi][0].length;
  const segs = [];
  let at = start;
  for (let i = lo; i <= hi; i++) {
    const t = tokens[i];
    if (t.index > at) segs.push({ text: text.slice(at, t.index), hit: false });
    segs.push({ text: t[0], hit: hitAt(t) });
    at = t.index + t[0].length;
  }
  if (lo > 0) segs.unshift({ text: "…", hit: false });
  if (end < text.length) segs.push({ text: "…", hit: false });
  return segs.map((s) => ({ ...s, text: s.text.replace(/\s+/g, " ") }));
}

/**
 * Search an index. `filters`: { fromYear, toYear, placeIds (Set|array; the place and places below it, resolved by
 * the caller), sourceKinds (array), sourceIds (Set|array|null: the scope; null = whole library), confirmedOnly,
 * onlyDated }. With a year range, text with no date at all is kept (marked `undated`, after the dated hits) unless
 * `onlyDated` (reviewer decision); text dated outside the range is excluded.
 * Returns [{ regionId, score, reasons, snippet, undated?, ...stored fields }], best first.
 */
export function runQuery(index, q, { filters = {}, nameVariants = [], limit = 50 } = {}) {
  const { expansions, expr } = expandQuery(q, variantMap(nameVariants));
  const [d0, d1] = yearDays(filters.fromYear, filters.toYear);
  const dated = Number.isFinite(d0) || Number.isFinite(d1);
  const places = filters.placeIds ? new Set(filters.placeIds) : null;
  const kinds = filters.sourceKinds?.length ? new Set(filters.sourceKinds) : null;
  const scope = filters.sourceIds ? new Set(filters.sourceIds) : null;
  const keep = (r) => {
    if (filters.confirmedOnly && !r.hasConfirmed) return false;
    if (kinds && !kinds.has(r.sourceKind)) return false;
    if (scope && !scope.has(r.sourceId)) return false;
    if (dated && r.earliestDay == null && filters.onlyDated) return false;
    if (dated && r.earliestDay != null && (r.latestDay < d0 || r.earliestDay > d1)) return false;
    if (places && !(r.placeIds ?? []).some((id) => places.has(id))) return false;
    return true;
  };
  if (!expr) return [];
  const terms = expansions.flatMap((e) => [e.word, ...e.variants]);
  let found = index.search(expr, { filter: keep });
  if (dated) found = [...found.filter((h) => h.earliestDay != null), ...found.filter((h) => h.earliestDay == null)];   // undated after the dated
  return found.slice(0, Math.min(limit, MAX_RESULTS)).map((h) => ({
    ...h,
    ...(dated && h.earliestDay == null ? { undated: true } : {}),
    regionId: h.id,
    reasons: reasonsOf(h, expansions),
    snippet: snippetOf(h.snippetSource, [...terms, ...Object.keys(h.match ?? {})]),
    snippetSource: undefined,
  }));
}
