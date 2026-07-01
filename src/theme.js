export const C = {
  paper: "#E8EAE1",
  paperHi: "#F3F4ED",
  ink: "#23312B",
  inkSoft: "#4A5850",
  rule: "#C7CDBD",
  ruleFaint: "#D8DCCE",
  slate: "#54656C",
  focus: "#8A3033",
  rel: ["#5C4A6E", "#8A6A2F", "#34635C", "#6B4A2F", "#445A75"],
};

export const hexA = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const btnStyle = (active) => ({
  font: "600 12px Archivo, system-ui, sans-serif",
  color: active ? C.paperHi : C.ink,
  background: active ? C.ink : C.paperHi,
  border: `1px solid ${C.ink}`,
  borderRadius: 3,
  padding: "5px 10px",
  cursor: "pointer",
  whiteSpace: "nowrap",
});

/* ── "Verified" affordance ──────────────────────────────────────────────
   Verified facts read as solid, filled markers tagged with a ✓; unverified
   ones are dashed and hollow. Centralized so every lane item stays in step. */
export const VERIFIED_MARK = "✓";

// "✓ " (prefix) or " ✓" (suffix) when verified, else "" — for labels/tooltips.
export const verifiedTick = (verified, pos = "prefix") =>
  verified ? (pos === "suffix" ? ` ${VERIFIED_MARK}` : `${VERIFIED_MARK} `) : "";

export const verifiedBorderStyle = (verified) => (verified ? "solid" : "dashed");

// Fill + border for a point marker (dot/diamond). `width` = border px; `fill`
// paints the marker with `color` when verified (else paper); `borderAlpha`,
// when given, fades the border via hexA(color, verified ? 1 : borderAlpha).
export const verifiedMarker = (verified, color, { width = 1.5, fill = false, borderAlpha } = {}) => ({
  background: fill && verified ? color : C.paperHi,
  border: `${width}px ${verified ? "solid" : "dashed"} ${borderAlpha == null ? color : hexA(color, verified ? 1 : borderAlpha)}`,
});

/* Event marker types — icon + color per `event.type`. `note` is the neutral
   fallback for unknown/legacy types. */
export const EVENT_TYPES = {
  marriage:     { label: "Marriage",   icon: "⚭", color: "#8A6A2F" },
  office:       { label: "Office/role", icon: "★", color: "#445A75" },
  property:     { label: "Property",   icon: "◈", color: "#34635C" },
  military:     { label: "Military",   icon: "⚔", color: "#6B4A2F" },
  birth:        { label: "Birth",      icon: "◉", color: "#34635C" },
  "death-note": { label: "Death",      icon: "✝", color: "#8A3033" },
  media:        { label: "Media",      icon: "❏", color: "#5C4A6E" },
  note:         { label: "Note",       icon: "•", color: "#54656C" },
};

export const eventType = (type) => EVENT_TYPES[type] ?? EVENT_TYPES.note;

/* Swatches offered by the item color picker. */
export const ITEM_COLORS = ["#8A3033", "#5C4A6E", "#8A6A2F", "#34635C", "#6B4A2F", "#445A75", "#54656C"];

export const SOURCE_TYPES = ["image", "document", "audio", "video", "url", "text"];

export const SOURCE_TYPE_LABELS = {
  image: "IMG",
  document: "DOC",
  audio: "AUD",
  video: "VID",
  url: "URL",
  text: "TXT",
};

export const SOURCE_TYPE_ACCEPT = {
  image: "image/*",
  document: ".pdf,.doc,.docx,.txt,.rtf,.odt",
  audio: "audio/*",
  video: "video/*",
  url: null,
  text: null,
};
