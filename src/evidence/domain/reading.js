import { invalid } from "./errors.js";

// A "reading" is the researcher's modern reading of a page or region, kept beside the machine transcription.
// Each correction replaces one fragment of the reading's text and records why: the fragment before, the new text,
// and optionally a link to the source the researcher knows it from. These pure helpers do the offset arithmetic;
// the text layer store turns each result into a new layer that supersedes the previous reading.

/** Optional source link: "" or an http(s) URL. Anything else (javascript:, data:, relative paths) is refused. */
export function checkLink(url) {
  const s = String(url ?? "").trim();
  if (!s) return "";
  let parsed;
  try { parsed = new URL(s); } catch { throw invalid("the link must be a full web address (https://…)"); }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw invalid("the link must start with https:// or http://");
  return parsed.href;
}

/** Fragments written in square brackets, marked as uncertain or illegible: [{ start, end, text }] (end exclusive, brackets included). */
export function uncertainSpans(text) {
  const out = [];
  const re = /\[[^\[\]\n]*\]/g;
  let m;
  while ((m = re.exec(String(text ?? "")))) out.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
  return out;
}

/** Annotations still attached to text (not overwritten by a later change). */
export const activeAnnotations = (annotations = []) => annotations.filter((a) => !a.replacedBy);

/**
 * Replace text[start, end) by `after` and move the annotations with it: annotations before the change stay,
 * those after it shift, those the change touches are kept for the record but marked `replacedBy` (no offsets).
 */
function replaceRange(text, annotations, start, end, after, replacedBy) {
  const delta = after.length - (end - start);
  const next = (annotations ?? []).map((a) => {
    if (a.replacedBy) return a;
    if (a.end <= start) return a;                                                              // entirely before the change
    if (a.start >= end) return { ...a, start: a.start + delta, end: a.end + delta };          // entirely after: shift
    return { ...a, start: null, end: null, replacedBy };                                       // overlapped: superseded by the change
  });
  return { text: text.slice(0, start) + after + text.slice(end), annotations: next };
}

function checkRange(text, start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > text.length) {
    throw invalid(`the fragment must lie inside the text (0..${text.length})`);
  }
}

/**
 * A sourced correction: replace text[start, end) by `after`, recording the old fragment, the link and a note.
 * Returns { text, annotations, annotation }.
 */
export function applyCorrection({ text, annotations = [], start, end, after, url = "", note = "", id, createdAt }) {
  const t = String(text ?? "");
  checkRange(t, start, end);
  if (typeof after !== "string") throw invalid("the corrected text must be a string");
  const before = t.slice(start, end);
  if (before === after) throw invalid("the corrected text is the same as the fragment");
  const link = checkLink(url);
  const r = replaceRange(t, annotations, start, end, after, id);
  const annotation = { id, start, end: start + after.length, before, after, url: link, note: String(note ?? "").trim(), createdAt };
  return { text: r.text, annotations: [...r.annotations, annotation], annotation };
}

/** A free rewrite of the whole text: the changed middle part (common prefix and suffix kept) moves the annotations. */
export function applyRewrite({ text, annotations = [], newText, marker = "rewrite" }) {
  const a = String(text ?? ""), b = String(newText ?? "");
  if (a === b) return { text: a, annotations, changed: false };
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const r = replaceRange(a, annotations, p, a.length - s, b.slice(p, b.length - s), marker);
  return { text: r.text, annotations: r.annotations, changed: true };
}
