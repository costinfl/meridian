import { describe, it, expect } from "vitest";
import { buildLanes, lookupsFor, boardRange, OPACITY } from "../context/lanes.js";
import { SAMPLE_PEOPLE } from "../sampleData.js";
import { createPeriod } from "../models/project.js";

const byId = Object.fromEntries(SAMPLE_PEOPLE.map((p) => [p.id, p]));
const lane = (lanes, id) => lanes.find((l) => l.id === id);
const labels = (l) => l.items.map((i) => i.label);

describe("Context lanes from the board (B3)", () => {
  it("the sample family offline: Local chips Săhăteni and Ploiești with the built-in events; National Romania; no 'unknown' place", () => {
    const lanes = buildLanes({ people: [byId.i1, byId.i5], source: "builtin" });
    const local = lane(lanes, "local");
    expect(local.chips.map((c) => c.key)).toEqual(["sahateni", "ploiesti"]);
    expect(local.chips.find((c) => c.key === "ploiesti").people).toEqual(["Dumitru", "Gheorghe"]);
    expect(labels(local)).toContain("Railway reaches Ploiești");
    expect(labels(local)).toContain("Săhăteni moved to Buzău county");
    const nat = lane(lanes, "national");
    expect(nat.chips.map((c) => c.label)).toEqual(["Romania"]);
    expect(labels(nat)).toContain("Great Union");
    expect(lane(lanes, "global").items.length).toBeGreaterThan(0);
  });

  it("a relative from another city brings its chip and events; fading by the time spent there; a chip switched off fades", () => {
    const cluj = { id: "c", name: "Ana Pop", birth: { year: 1880, place: "Cluj" }, death: { year: 1950, place: "Cluj" } };
    const resolved = { cluj: { qid: "Q100188", label: "Cluj-Napoca" }, sahateni: "none", ploiesti: { qid: "Q179585", label: "Ploiești" } };
    const histories = { Q100188: { states: [{ qid: "Q28513", label: "Austria-Hungary", from: 1867, to: 1918 }, { qid: "Q203493", label: "Kingdom of Romania", from: 1918, to: 1947 }], county: "Cluj County" } };
    const fetched = { place: { Q100188: [{ id: "wd:Q1", label: "Cluj protest", year: 1870 }, { id: "wd:Q2", label: "Cluj bombing", year: 1944 }] }, state: { Q28513: [{ id: "wd:Q3", label: "Ausgleich", year: 1867 }, { id: "wd:Q4", label: "Hungarian law", year: 1890 }] } };
    const lanes = buildLanes({ people: [byId.i1, cluj], resolved, histories, fetched });
    const local = lane(lanes, "local");
    expect(local.chips.map((c) => c.label)).toEqual(["Săhăteni", "Ploiești", "Cluj-Napoca"]);
    const item = (l, label) => l.items.find((i) => i.label === label);
    expect(item(local, "Cluj protest").opacity).toBe(OPACITY.absent);        // before Ana lived there
    expect(item(local, "Cluj bombing").opacity).toBe(OPACITY.present);
    const nat = lane(lanes, "national");
    expect(nat.chips.map((c) => c.key).sort()).toEqual(["austria-hungary", "romania"]);
    expect(nat.chips.find((c) => c.key === "austria-hungary").title).toBe("Austria-Hungary 1880–1918");
    expect(item(nat, "Hungarian law").opacity).toBe(OPACITY.present);
    expect(item(nat, "Ausgleich")).toBeUndefined();                           // outside the years someone was there (and before 1880 in the state's span)
    const off = buildLanes({ people: [byId.i1, cluj], resolved, histories, fetched, filters: { local: { "cluj": false } } });
    expect(item(lane(off, "local"), "Cluj bombing").opacity).toBe(OPACITY.off);
    expect(lane(off, "local").chips.find((c) => c.key === "cluj").on).toBe(false);
  });

  it("a new empty project has no Săhăteni; your own events show on their lane", () => {
    const newcomer = { id: "n", name: "Ion Pop", birth: { year: 1900 } };
    const lanes = buildLanes({ people: [newcomer], source: "builtin", own: [{ id: "o1", lane: "local", chip: null, label: "Village fair", year: 1920 }] });
    const local = lane(lanes, "local");
    expect(local.chips).toEqual([]);
    expect(local.empty).toBe(true);
    expect(labels(local)).toEqual(["Village fair"]);
    expect(local.items[0]).toMatchObject({ own: true, opacity: 1 });
    expect(labels(lane(lanes, "national"))).toEqual([]);
  });

  it("built-in only uses no fetched events; the board's range; the lookups needed", () => {
    const fetched = { global: [{ id: "wd:Q9", label: "Something global", year: 1900 }] };
    expect(labels(lane(buildLanes({ people: [byId.i1], fetched, source: "builtin" }), "global"))).not.toContain("Something global");
    expect(labels(lane(buildLanes({ people: [byId.i1], fetched }), "global"))).toContain("Something global");
    expect(boardRange([byId.i1, byId.i5])).toEqual([1850, 1952]);
    const student = { id: "s", birth: { year: 1850, place: "Ploiești" }, death: { year: 1920 }, periods: [createPeriod({ start: 1870, end: 1874, label: "Student", place: "București" })] };
    const need = lookupsFor([student], { resolved: { ploiesti: { qid: "Q179585" } }, histories: { Q179585: { states: [{ qid: "Q203493", label: "Kingdom of Romania", from: 1881, to: 1947 }] } } });
    expect(need.unresolved).toEqual([{ key: "bucuresti", place: "București" }]);
    expect(need.placeEvents).toEqual([{ qid: "Q179585", from: 1850, to: 1929 }]);
    expect(need.stateEvents).toEqual([{ qid: "Q203493", from: 1880, to: 1929 }]);
    expect(need.global).toEqual({ from: 1850, to: 1929 });
  });
});
