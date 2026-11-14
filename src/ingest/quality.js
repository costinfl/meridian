// Is the text embedded in a PDF page good enough to use, or should the page be sent to OCR?
// Embedded text layers are sometimes garbage (broken font encodings, a poor earlier OCR). The check is
// deliberately simple and language-neutral: the share of tokens that look like words or numbers.

export const DEFAULT_QUALITY = { minChars: 20, minPlausibleShare: 0.6 };

const VOWEL = /[aeiouyăâîáéíóúàèìòùäëïöüőűåæøąęů]/i;
const WORD = /^[\p{L}]+(?:[-'’][\p{L}]+)*$/u;
const NUMBER = /^\d+(?:[.,/:-]\d+)*$/;
const trimPunct = (t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

export function isPlausibleToken(token) {
  const t = trimPunct(token);
  if (!t) return false;
  if (NUMBER.test(t)) return true;
  if (!WORD.test(t) || t.length > 30) return false;
  if (t.length === 1) return true;                    // "a", "o", "e", initials
  return VOWEL.test(t) || t.length <= 4 && t === t.toUpperCase(); // words have vowels; short all-caps are abbreviations
}

/** { ok, chars, tokens, plausibleShare, reason } */
export function assessText(text, options = {}) {
  const { minChars, minPlausibleShare } = { ...DEFAULT_QUALITY, ...options };
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  const tokens = clean ? clean.split(" ").filter((t) => trimPunct(t)) : [];
  const plausible = tokens.filter(isPlausibleToken).length;
  const share = tokens.length ? plausible / tokens.length : 0;
  const out = { chars: clean.length, tokens: tokens.length, plausibleShare: Math.round(share * 1000) / 1000 };
  if (clean.length < minChars) return { ok: false, ...out, reason: `only ${clean.length} characters of embedded text` };
  if (share < minPlausibleShare) return { ok: false, ...out, reason: `only ${Math.round(share * 100)}% of the embedded text looks like words` };
  return { ok: true, ...out, reason: "" };
}
