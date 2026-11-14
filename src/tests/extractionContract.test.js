import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { validateExtraction, toEvidence, EXTRACTION_SCHEMA, defaultCalendar } from "../extract/contract.js";
import { RECORD_KINDS, ROLES } from "../evidence/repositories/recordStore.js";
import { RELATION_PROPERTIES } from "../evidence/repositories/assertionStore.js";

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "extraction", name), "utf8"));
const clone = (x) => JSON.parse(JSON.stringify(x));
const death = fixture("death-1866.json");

describe("extraction contract v1 (P6.T1)", () => {
  it("its enums are exactly the library's record kinds, roles and relation properties", () => {
    const d = EXTRACTION_SCHEMA.definitions;
    expect(d.record.properties.kind.enum).toEqual(RECORD_KINDS);
    expect(d.persona.properties.role.enum).toEqual(ROLES);
    expect(d.relation.properties.property.enum).toEqual(RELATION_PROPERTIES);
  });

  it("accepts the 1866 death act and an empty page", () => {
    expect(validateExtraction(death)).toEqual({ ok: true, errors: [] });
    expect(validateExtraction({ schemaVersion: "1", records: [] }).ok).toBe(true);
  });

  const invalid = [
    ["not an object", "nope", /must be object/],
    ["wrong schema version", { schemaVersion: "2", records: [] }, /schemaVersion must be equal to constant/],
    ["unknown top-level field", { schemaVersion: "1", records: [], extra: 1 }, /must NOT have additional properties 'extra'/],
    ["unknown kind", (o) => { o.records[0].kind = "funeral"; }, /kind must be equal to one of the allowed values/],
    ["persona without a name", (o) => { delete o.records[0].personas[0].nameAsWritten; }, /must have required property 'nameAsWritten'/],
    ["unknown role", (o) => { o.records[0].personas[0].role = "cousin"; }, /role must be equal to one of the allowed values/],
    ["box outside 0-1", (o) => { o.records[0].box.x1 = 1.4; }, /box\/x1 must be <= 1/],
    ["inverted box", (o) => { o.records[0].box = { x0: 0.5, y0: 0.1, x1: 0.2, y1: 0.3 }; }, /x0 < x1/],
    ["duplicate persona key", (o) => { o.records[0].personas[1].key = "d"; }, /duplicate key 'd'/],
    ["relation to an unknown persona", (o) => { o.records[0].relations[0].object = "zz"; }, /unknown object 'zz'/],
    ["relation to itself", (o) => { o.records[0].relations[0].object = "a"; }, /cannot be related to itself/],
    ["impossible date", (o) => { o.records[0].eventDate = { asWritten: "30 febr. 1866", year: 1866, month: 2, day: 30 }; }, /day out of range/],
    ["implausible year", (o) => { o.records[0].eventDate.year = 2866; }, /year 2866 is not plausible/],
    ["day without a month", (o) => { delete o.records[0].eventDate.month; }, /day without a month/],
    ["confidence above 1", (o) => { o.records[0].confidence = 7; }, /confidence must be <= 1/],
  ];
  for (const [name, change, re] of invalid) {
    it(`rejects: ${name}`, () => {
      const o = typeof change === "function" ? (() => { const c = clone(death); change(c); return c; })() : change;
      const r = validateExtraction(o);
      expect(r.ok).toBe(false);
      expect(r.errors.join("\n")).toMatch(re);
    });
  }

  it("dates default to the Julian calendar before 1919 (Romania's change), Gregorian after", () => {
    expect(defaultCalendar(1866)).toBe("julian");
    expect(defaultCalendar(1918)).toBe("julian");
    expect(defaultCalendar(1919)).toBe("gregorian");
  });
});

describe("toEvidence: valid output to store inputs", () => {
  it("maps the 1866 death act to a record, three personas and one assertion per stated fact", () => {
    const [r] = toEvidence(death);
    expect(r.kind).toBe("death");
    expect(r.box).toEqual({ x0: 0.05, y0: 0.08, x1: 0.97, y1: 0.72 });
    expect(r.event).toMatchObject({ earliest: "1866-03-26", latest: "1866-03-26", calendar: "julian", precision: "day" });
    expect(r.personas.map((p) => [p.key, p.nameAsWritten, p.role, p.statedAge?.value ?? null])).toEqual([
      ["d", "Șfatu Loti", "deceased", 62], ["a", "Alecsandru Drăgoiescu", "informant", null], ["c", "Constandin Cristescu", "informant", 32],
    ]);
    const by = (s) => r.assertions.filter((a) => a.subject === s).map((a) => [a.property, a.originalValue]);
    expect(by("record")).toEqual([["event.date", death.records[0].eventDate.asWritten], ["event.place", "Craiova, în casa D. Drăgoiescu, Mahalaua [Brândușa?]"]]);
    expect(by("d")).toEqual([["name", "Șfatu Loti"], ["role", "deceased"], ["sex", "female"], ["age", "șaizeci și doi ani"], ["residence", "Craiova"], ["x-religion", "Catolică"]]);
    expect(by("a").map((x) => x[0])).toEqual(["name", "role", "sex", "occupation", "residence", "informantFor"]);
    const rel = r.assertions.find((a) => a.subject === "a" && a.property === "informantFor");
    expect(rel).toMatchObject({ objectKey: "d", originalValue: "nepotu mortei", confidence: 0.7 });
    expect(r.assertions.find((a) => a.property === "age" && a.subject === "c").normalizedValue).toEqual({ value: 32, unit: "years" });
    expect(r.assertions.every((a) => a.confidence === 0.7)).toBe(true);
  });

  it("a date without a year is kept as written under an x- property; empty fields give no assertion", () => {
    const o = { schemaVersion: "1", records: [{ kind: "baptism", eventDate: { asWritten: "Duminică, la Sf. Nicolae" }, personas: [{ key: "p1", nameAsWritten: "Ion", role: "child", occupation: "  " }] }] };
    expect(validateExtraction(o).ok).toBe(true);
    const [r] = toEvidence(o);
    expect(r.event).toBeNull();
    expect(r.assertions.map((a) => [a.subject, a.property, a.originalValue])).toEqual([
      ["record", "x-event.date-unparsed", "Duminică, la Sf. Nicolae"], ["p1", "name", "Ion"], ["p1", "role", "child"],
    ]);
  });
});
