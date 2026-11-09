// Optional sidecar metadata: a JSON file next to a document, named "<file name>.meta.json", e.g.
//   botezuri-1843.pdf            botezuri-1843.pdf.meta.json
//   { "sourceTitle": "Registrul de botezuri, Sf. Nicolae, 1843", "repository": "Arhivele Naționale Prahova",
//     "date": "1843", "pageLabel": "f. 23v", "accessUrl": "https://...", "kind": "parish-register",
//     "handwritten": true }
// All fields are optional strings (handwritten: boolean). Unknown fields are ignored and reported.

const STRING_FIELDS = ["sourceTitle", "repository", "date", "pageLabel", "accessUrl", "kind"];

/** Returns { meta, warnings } or { error }. Never throws. */
export function parseSidecar(text) {
  let raw;
  try { raw = JSON.parse(text); } catch (e) { return { error: `not valid JSON: ${e.message}` }; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "must be a JSON object" };
  const meta = {}, warnings = [];
  for (const [k, v] of Object.entries(raw)) {
    if (STRING_FIELDS.includes(k)) {
      if (typeof v === "string") { if (v.trim()) meta[k] = v.trim(); } else warnings.push(`${k} must be text; ignored`);
    } else if (k === "handwritten") {
      if (typeof v === "boolean") meta.handwritten = v; else warnings.push("handwritten must be true or false; ignored");
    } else warnings.push(`unknown field ${k}; ignored`);
  }
  return { meta, warnings };
}
