import { describe, it, expect } from "vitest";
import { ancestors, descendants, commonAncestors, kinshipLabel } from "../graph/index.js";
import { createProject, normalizeProject } from "../models/project.js";
import { SAMPLE_PEOPLE } from "../sampleData.js";

/** Today's label function (copied from App.jsx before Phase 8) to prove the new one keeps its answers. */
function oldRelationTo(p, f, byId) {
  if (!f || p.id === f.id) return "";
  if (p.id === f.fatherId) return "father";
  if (p.id === f.motherId) return "mother";
  if ((f.spouseIds || []).includes(p.id)) return "spouse";
  if (p.fatherId === f.id || p.motherId === f.id) return "child";
  if ((p.fatherId && p.fatherId === f.fatherId) || (p.motherId && p.motherId === f.motherId)) return "sibling";
  const fF = byId[f.fatherId], fM = byId[f.motherId];
  if ((fF && (p.id === fF.fatherId || p.id === fF.motherId)) || (fM && (p.id === fM.fatherId || p.id === fM.motherId))) return "grandparent";
  const pF = byId[p.fatherId], pM = byId[p.motherId];
  if ((pF && (pF.fatherId === f.id || pF.motherId === f.id)) || (pM && (pM.fatherId === f.id || pM.motherId === f.id))) return "grandchild";
  return "relative";
}

/** A family over five generations, with cousins marrying (endogamy). */
function tree() {
  const P = (id, sex, fatherId = null, motherId = null, spouseIds = []) => ({ id, name: id, sex, fatherId, motherId, spouseIds });
  const list = [
    P("gg1", "M", null, null, ["gg2"]), P("gg2", "F", null, null, ["gg1"]),
    P("g1", "M", "gg1", "gg2", ["g2"]), P("g2", "F", null, null, ["g1"]),           // grandparents
    P("ga", "F", "gg1", "gg2", []),                                                   // g1's sister
    P("f", "M", "g1", "g2", ["m"]), P("m", "F", null, null, ["f"]),                  // parents
    P("u", "M", "g1", "g2", ["ua"]), P("ua", "F", null, null, ["u"]),                // uncle and his wife
    P("me", "M", "f", "m", ["w"]), P("w", "F", "wf", null, ["me"]), P("wf", "M", null, null, []),
    P("sis", "F", "f", "m", ["bil"]), P("bil", "M", null, null, ["sis"]),
    P("c1", "F", "u", "ua", []),                                                     // first cousin
    P("c1k", "M", null, "c1", []),                                                   // first cousin once removed
    P("nep", "M", "bil", "sis", []), P("gnep", "F", "nep", null, []),
    P("son", "M", "me", "w", ["dil"]), P("dil", "F", null, null, ["son"]), P("gs", "M", "son", "dil", []), P("ggs", "F", "gs", null, []),
    P("ka", "M", null, "ga", []), P("kb", "F", null, "ga", []),                      // second cousins (via gg1/gg2)
    P("step", "M", null, null, ["m"]),                                                // mother's second husband (same parents set aside)
  ];
  // endogamy: c1's son c1k marries sis's daughter; their child shares g1/g2 through two lines
  list.push(P("sd", "F", "bil", "sis", ["c1k"]));
  list.find((x) => x.id === "c1k").spouseIds = ["sd"];
  list.push(P("endo", "M", "c1k", "sd", []));
  list.find((x) => x.id === "m").spouseIds = ["f", "step"];
  return Object.fromEntries(list.map((p) => [p.id, p]));
}

describe("kinship (P8.T4)", () => {
  it("today's labels are unchanged for every pair of the sample family", () => {
    const people = normalizeProject(createProject("S", { people: SAMPLE_PEOPLE })).people;
    const byId = Object.fromEntries(people.map((p) => [p.id, p]));
    let compared = 0;
    for (const f of people) for (const p of people) {
      const before = oldRelationTo(p, f, byId);
      if (before === "relative") continue;                                            // the only label that becomes precise
      expect(kinshipLabel(byId, f, p), `${p.id} to ${f.id}`).toBe(before);
      compared++;
    }
    expect(compared).toBeGreaterThan(10);
  });

  it("precise labels: great-grandparents, uncles, nephews, cousins with removal, in-laws, step, spouse of a relative", () => {
    const b = tree(), L = (f, p) => kinshipLabel(b, b[f], b[p]);
    expect(L("me", "gg1")).toBe("great-grandfather");
    expect(L("gg1", "me")).toBe("great-grandson");
    expect(L("gg1", "gs")).toBe("3× great-grandson");                                 // 5 generations down
    expect(L("me", "u")).toBe("uncle");
    expect(L("me", "ga")).toBe("great-aunt");
    expect(L("u", "me")).toBe("nephew");
    expect(L("me", "nep")).toBe("nephew");
    expect(L("me", "gnep")).toBe("great-niece");
    expect(L("me", "c1")).toBe("first cousin");
    expect(L("me", "c1k")).toBe("first cousin once removed");
    expect(L("c1k", "me")).toBe("first cousin once removed");
    expect(L("me", "ka")).toBe("first cousin once removed");                       // ka is my father's first cousin
    expect(L("c1k", "ka")).toBe("first cousin twice removed");
    const t2 = { ...b, kc: { id: "kc", sex: "M", fatherId: "ka", motherId: null, spouseIds: [] } };
    expect(kinshipLabel(t2, t2.c1, t2.kc)).toBe("second cousin");
    expect(L("me", "wf")).toBe("father-in-law");
    expect(L("me", "dil")).toBe("daughter-in-law");
    expect(L("me", "bil")).toBe("brother-in-law");
    expect(L("me", "step")).toBe("stepfather");
    expect(L("me", "ua")).toBe("wife of uncle");
    expect(L("me", "gg2")).toBe("great-grandmother");
    expect(kinshipLabel(b, b.me, { id: "x", name: "stranger", fatherId: null, motherId: null })).toBe("relative");
    // today's labels still win where they apply
    expect(L("me", "g1")).toBe("grandparent");
    expect(L("me", "sis")).toBe("sibling");
  });

  it("endogamy: the same ancestors through two lines terminate, are counted, and are reported as 'related twice'", () => {
    const b = tree();
    const A = ancestors(b, "endo");
    expect(A.get("g1")).toEqual({ generations: [4], paths: 2 });                       // via c1k and via sd
    expect(A.get("gg1").paths).toBe(2);
    expect(descendants(b, "g1").get("endo")).toEqual([4]);
    expect(commonAncestors(b, "c1k", "sd")).toEqual([{ id: "g1", a: 3, b: 3 }, { id: "g2", a: 3, b: 3 }]);
    expect(kinshipLabel(b, b.c1k, b.sd)).toBe("spouse");                             // spouse comes first, as today
    // endo's relation to his great-uncle u: through c1k only; to "me": through his mother sd (my niece) and his father c1k (my cousin's son)
    expect(kinshipLabel(b, b.endo, b.me)).toMatch(/^great-uncle|first cousin twice removed/);
    // double first cousins: two brothers married two sisters
    const P = (id, sex, fatherId = null, motherId = null, spouseIds = []) => ({ id, sex, fatherId, motherId, spouseIds });
    const dd = Object.fromEntries([
      P("P1", "M", null, null, ["P2"]), P("P2", "F", null, null, ["P1"]), P("Q1", "M", null, null, ["Q2"]), P("Q2", "F", null, null, ["Q1"]),
      P("b1", "M", "P1", "P2", ["s1"]), P("b2", "M", "P1", "P2", ["s2"]), P("s1", "F", "Q1", "Q2", ["b1"]), P("s2", "F", "Q1", "Q2", ["b2"]),
      P("k1", "M", "b1", "s1"), P("k2", "F", "b2", "s2"),
    ].map((x) => [x.id, x]));
    expect(kinshipLabel(dd, dd.k1, dd.k2)).toBe("first cousin, related twice");
  });

  it("bad data (a person entered as their own ancestor) still terminates", () => {
    const loop = { a: { id: "a", fatherId: "b" }, b: { id: "b", fatherId: "a" } };
    const A = ancestors(loop, "a");
    expect(A.get("b").generations[0]).toBe(1);
    expect(A.get("a").generations.length).toBeLessThanOrEqual(15);
    expect(kinshipLabel(loop, loop.a, loop.b)).toBe("father");
  });
});
