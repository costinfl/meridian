// Romanian-aware text normalisation (Layer 2 normalised text, Layer 3 name keys, search keys).
//  - normalizeText: canonical form for storage. NFC, cedilla -> comma-below (ş->ș, ţ->ț), whitespace
//    collapsed. Case and diacritics are kept.
//  - searchKey: matching form. As above, then accents removed, lower case, punctuation -> space.
//    "Ştefan", "Ștefan", "ŞTEFAN" and "Stefan" all give "stefan".
//  - dmCodesOfName: Daitch-Mokotoff codes of every token of a name (computed on the searchKey).
import { daitchMokotoff } from "./daitchMokotoff.js";

const CEDILLA_TO_COMMA = { "ş": "ș", "Ş": "Ș", "ţ": "ț", "Ţ": "Ț" };

export function normalizeText(text) {
  return String(text ?? "")
    .normalize("NFC")
    .replace(/[şŞţŢ]/g, (c) => CEDILLA_TO_COMMA[c])
    .replace(/\s+/g, " ")
    .trim();
}

export function searchKey(text) {
  return normalizeText(text)
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Tokens (>= 2 letters) of a name as written, folded to their search keys. */
export function nameTokens(name) {
  return searchKey(name).split(" ").filter((t) => t.length >= 2);
}

/** Daitch-Mokotoff codes of every token of `name`, de-duplicated. */
export function dmCodesOfName(name) {
  const out = new Set();
  for (const t of nameTokens(name)) for (const c of daitchMokotoff(t)) out.add(c);
  return [...out].sort();
}
