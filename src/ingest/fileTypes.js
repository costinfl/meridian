// Which files ingestion understands, by extension (the browser's MIME type is unreliable for folder files).

const BY_EXT = {
  pdf: { kind: "pdf", mimeType: "application/pdf" },
  docx: { kind: "docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  jpg: { kind: "image", mimeType: "image/jpeg" },
  jpeg: { kind: "image", mimeType: "image/jpeg" },
  png: { kind: "image", mimeType: "image/png" },
  tif: { kind: "image", mimeType: "image/tiff" },
  tiff: { kind: "image", mimeType: "image/tiff" },
};
const UNSUPPORTED = {
  doc: "Legacy .doc files are not supported: convert to DOCX or PDF (for example with Google Drive: File > Download)",
};

export const SIDECAR_SUFFIX = ".meta.json";
export const isSidecar = (name) => String(name).toLowerCase().endsWith(SIDECAR_SUFFIX);
export const extensionOf = (name) => { const m = /\.([a-z0-9]+)$/i.exec(String(name)); return m ? m[1].toLowerCase() : ""; };

/** { supported: true, kind: "pdf"|"docx"|"image", mimeType } or { supported: false, reason } */
export function classifyFile(name) {
  const ext = extensionOf(name);
  if (BY_EXT[ext]) return { supported: true, ...BY_EXT[ext] };
  return { supported: false, reason: UNSUPPORTED[ext] ?? `Files of type .${ext || "?"} are not read` };
}
