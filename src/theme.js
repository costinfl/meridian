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
