import { describe, it, expect } from "vitest";
import { normalizeText, searchKey, nameTokens, dmCodesOfName } from "../evidence/domain/normalize.js";
import { daitchMokotoff } from "../evidence/domain/daitchMokotoff.js";

describe("normalizeText", () => {
  it("turns cedilla forms into comma-below forms, keeping case and other diacritics", () => {
    expect(normalizeText("Ştefan Ţărănu")).toBe("Ștefan Țărănu");
    expect(normalizeText("ŞTEFAN ŢĂRĂNU")).toBe("ȘTEFAN ȚĂRĂNU");
    expect(normalizeText("Băltăceanu din Ploiești")).toBe("Băltăceanu din Ploiești");
  });
  it("composes decomposed input and collapses whitespace", () => {
    expect(normalizeText("Ştefan")).toBe("Ștefan"); // S + combining cedilla -> Ş -> Ș
    expect(normalizeText("  Ion \n\t Popescu  ")).toBe("Ion Popescu");
    expect(normalizeText(null)).toBe("");
  });
  it("is idempotent", () => {
    const once = normalizeText("Ştefan  Ţărănu");
    expect(normalizeText(once)).toBe(once);
  });
});

describe("searchKey", () => {
  it('"Ştefan", "Ștefan" and "Stefan" share one key (any case)', () => {
    const keys = ["Ştefan", "Ștefan", "Stefan", "ŞTEFAN", "ȘTEFAN", "stefan", "Ştefan"].map(searchKey);
    expect(new Set(keys)).toEqual(new Set(["stefan"]));
  });
  it("folds every Romanian diacritic and punctuation", () => {
    expect(searchKey("Țărănu")).toBe("taranu");
    expect(searchKey("Băltăceanu-Văleanu")).toBe("baltaceanu valeanu");
    expect(searchKey("Ploiești, jud. Prahova")).toBe("ploiesti jud prahova");
    expect(searchKey("Fîntînă Mîndră")).toBe("fintina mindra");
    expect(searchKey("")).toBe("");
  });
  it("tokenises names", () => {
    expect(nameTokens("Dumitru D. Hariton")).toEqual(["dumitru", "hariton"]); // initials dropped
  });
});

describe("Daitch-Mokotoff", () => {
  it("reproduces published vectors", () => {
    expect(daitchMokotoff("Peters").sort()).toEqual(["734000", "739400"]);
    expect(daitchMokotoff("Moskowitz")).toEqual(["645740"]);
    expect(daitchMokotoff("Jackson").sort()).toEqual(["145460", "154600", "445460", "454600"]);
    expect(daitchMokotoff("Auerbach").sort()).toEqual(["097400", "097500"]);
    expect(daitchMokotoff("Ohrbach").sort()).toEqual(["097400", "097500"]);
  });
  it("gives Romanian surnames stable codes", () => {
    expect(daitchMokotoff("Hariton")).toEqual(["593600"]);
    expect(daitchMokotoff("Popescu")).toHaveLength(1);
    // spelling variants that differ in transcription share a code
    expect(daitchMokotoff("Moskowitz")).toEqual(daitchMokotoff("Moskovitz"));
  });
  it('"Ștefan" (comma-below) and "Ştefan" (cedilla) and "Stefan" share a code once folded', () => {
    const a = daitchMokotoff("Ștefan"), b = daitchMokotoff("Ştefan"), c = daitchMokotoff("Stefan");
    expect(a).toEqual(c); expect(b).toEqual(c);
    expect(a).toEqual(["276000"]);
  });
  it("returns 6-digit codes, handles empty and non-letter input, rejects non-strings", () => {
    for (const n of ["Hariton", "Ploiești", "Ion", "Xavier"]) for (const c of daitchMokotoff(n)) expect(c).toMatch(/^\d{6}$/);
    expect(daitchMokotoff("")).toEqual(["000000"]);
    expect(daitchMokotoff("123 -")).toEqual(["000000"]);
    expect(() => daitchMokotoff(5)).toThrow(TypeError);
  });
  it("dmCodesOfName unions the tokens of a name, sorted and de-duplicated", () => {
    const codes = dmCodesOfName("Dumitru D. Hariton");
    expect(codes).toContain("593600");
    expect(codes).toEqual([...new Set(codes)].sort());
    expect(dmCodesOfName("Ștefan Hariton")).toEqual(dmCodesOfName("Stefan Hariton"));
    expect(dmCodesOfName("")).toEqual([]);
  });
});
