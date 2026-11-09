/*
 * Daitch-Mokotoff Soundex.
 *
 * The rule table and matching procedure are ported from Talisman's `phonetics/daitch-mokotoff`
 * (https://github.com/Yomguithereal/talisman), MIT License, Copyright (c) 2016-2020 Guillaume
 * Plique, which in turn follows https://en.wikipedia.org/wiki/Daitch%E2%80%93Mokotoff_Soundex.
 * Rewritten as a dependency-free ES module (no lodash); input is folded with `searchKey`
 * (diacritics removed, comma-below and cedilla forms alike) before the rules run, so
 * "Ștefan", "Ştefan" and "Stefan" give the same codes. Verified against the original
 * package over several hundred names and against published vectors (see tests).
 *
 * Permission notice (MIT): Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files, to deal in the software without
 * restriction, subject to the inclusion of the above copyright notice and this permission notice
 * in all copies or substantial portions of the software. THE SOFTWARE IS PROVIDED "AS IS",
 * WITHOUT WARRANTY OF ANY KIND.
 */
import { searchKey } from "./normalize.js";

// Rules: [pattern|null, codeIfFirstLetter, codeIfBeforeVowel, codeOtherwise]; a code is a number,
// null (no code) or [a, b] (two alternatives).
const MNNM = /^(MN|NM)/;
const MN = /^(M|N)/;
const RULES = {
  A: [[/^(AI|AJ|AY)/, 0, 1, null], [/^AU/, 0, 7, null], [null, 0, null, null]],
  B: [[null, 7, 7, 7]],
  C: [[/^CHS/, 5, 54, 54], [/^CH/, [5, 4], [5, 4], [5, 4]], [/^CK/, [5, 45], [5, 45], [5, 45]], [/^(CSZ|CZS|CZ|CS)/, 4, 4, 4], [null, [5, 4], [5, 4], [5, 4]]],
  D: [[/^(DRZ|DRS|DSH|DSZ|DZH|DZS|DS|DZ)/, 4, 4, 4], [/^(DT|D)/, 3, 3, 3]],
  E: [[/^(EI|EJ|EY)/, 0, 1, null], [/^EU/, 1, 1, null], [null, 0, null, null]],
  F: [[/^(FB|F)/, 7, 7, 7]],
  G: [[null, 5, 5, 5]],
  H: [[null, 5, 5, null]],
  I: [[/^(IA|IE|IO|IU)/, 1, null, null], [null, 0, null, null]],
  J: [[null, [1, 4], [null, 4], [null, 4]]],
  K: [[/^KS/, 5, 54, 54], [/^(KH|K)/, 5, 5, 5]],
  L: [[null, 8, 8, 8]],
  M: [[MNNM, null, 66, 66], [MN, 6, 6, 6]],
  N: [[MNNM, null, 66, 66], [MN, 6, 6, 6]],
  O: [[/^(OI|OJ|OY)/, 0, 1, null], [null, 0, null, null]],
  P: [[/^(PF|PH|P)/, 7, 7, 7]],
  Q: [[null, 5, 5, 5]],
  R: [[/^(RZ|RS)/, [94, 4], [94, 4], [94, 4]], [null, 9, 9, 9]],
  S: [
    [/^(SCHTSCH|SCHTSH|SCHTCH|SHTCH|SHCH|SHTSH)/, 2, 4, 4], [/^SCH/, 4, 4, 4], [/^(SHT|SCHT|SCHD)/, 2, 43, 43],
    [/^SH/, 4, 4, 4], [/^(STCH|STSCH|SC|STRZ|STRS|STSH)/, 2, 4, 4], [/^ST/, 2, 43, 43], [/^(SZCZ|SZCS)/, 2, 4, 4],
    [/^(SZT|SHD|SZD|SD)/, 2, 43, 43], [/^(SZ|S)/, 4, 4, 4],
  ],
  T: [[/^(TCH|TTCH|TTSCH)/, 4, 4, 4], [/^TH/, 3, 3, 3], [/^(TRZ|TRS|TSCH|TSH|TS|TTS|TTSZ|TC|TZ|TTZ|TZS|TSZ)/, 4, 4, 4], [null, 3, 3, 3]],
  U: [[/^(UI|UJ|UY)/, 0, 1, null], [/^(UE|U)/, 0, null, null]],
  V: [[null, 7, 7, 7]],
  W: [[null, 7, 7, 7]],
  X: [[null, 5, 54, 54]],
  Y: [[null, 1, null, null]],
  Z: [[/^(ZHDZH|ZDZH|ZDZ)/, 2, 4, 4], [/^(ZHD|ZD)/, 2, 43, 43], [/^(ZSCH|ZSH|ZH|ZS|Z)/, 4, 4, 4]],
};
const VOWELS = new Set(["A", "E", "I", "O", "U", "Y"]);

const pad = (code) => (code + "000000").slice(0, 6);

function expand(parts) {
  let codes = [""];
  for (const part of parts) {
    if (Array.isArray(part)) {
      codes = [...codes.map((c) => c + (part[0] ?? "")), ...codes.map((c) => c + (part[1] ?? ""))];
    } else {
      codes = codes.map((c) => c + part);
    }
  }
  return codes;
}

/** Daitch-Mokotoff codes (6 digits each, possibly several) of ONE name token. */
export function daitchMokotoff(name) {
  if (typeof name !== "string") throw new TypeError("daitchMokotoff expects a string");
  let current = searchKey(name).toUpperCase().replace(/[^A-Z]/g, "");
  const parts = [];
  let start = true, lastPattern;
  while (current.length) {
    const first = current.charAt(0);
    for (const [pattern, ifFirst, vowelNext, usual] of RULES[first]) {
      const match = pattern ? current.match(pattern) : [first];
      if (!match) continue;
      const offset = match[0].length;
      let code = usual;
      if (start) code = ifFirst;
      else if (VOWELS.has(current.charAt(offset))) code = vowelNext;
      if (lastPattern !== pattern && code !== null) parts.push(code);
      lastPattern = pattern || first;
      current = current.slice(offset);
      break;
    }
    start = false;
  }
  return [...new Set(expand(parts).map(pad))];
}
