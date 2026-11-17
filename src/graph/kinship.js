// Kinship (P8.T4) over the people of a project (fatherId / motherId / spouseIds, derived from families).
// Ancestors and descendants are walked with a visited set per (person, generation) and a generation limit, so
// endogamy (the same ancestor through several lines) and even bad data (a person entered as their own ancestor)
// always terminate. Labels describe how `person` is related TO `focus` ("father" = person is focus's father).

export const MAX_GENERATIONS = 30;
const parentsOf = (byId, id) => { const p = byId[id]; return p ? [p.fatherId, p.motherId].filter((x) => x && byId[x]) : []; };

/** All ancestors: Map ancestorId -> sorted generations at which they are reached (1 = parent), and the number of paths. */
export function ancestors(byId, id, { maxGenerations = MAX_GENERATIONS } = {}) {
  const out = new Map();               // id -> { gens: Set, paths: number }
  let frontier = new Map([[id, 1]]);   // id -> number of paths reaching it at this generation
  for (let gen = 1; gen <= maxGenerations && frontier.size; gen++) {
    const next = new Map();
    for (const [cur, paths] of frontier) for (const par of parentsOf(byId, cur)) next.set(par, (next.get(par) ?? 0) + paths);
    for (const [a, paths] of next) {
      if (!out.has(a)) out.set(a, { gens: new Set(), paths: 0 });
      const e = out.get(a);
      e.gens.add(gen); e.paths += paths;
    }
    frontier = next;                   // a person reached again at a deeper generation is walked again, bounded by maxGenerations
  }
  return new Map([...out].map(([k, v]) => [k, { generations: [...v.gens].sort((a, b) => a - b), paths: v.paths }]));
}

/** All descendants: Map descendantId -> sorted generations (1 = child). */
export function descendants(byId, id, { maxGenerations = MAX_GENERATIONS } = {}) {
  const childrenOf = new Map();
  for (const p of Object.values(byId)) for (const par of [p.fatherId, p.motherId]) if (par) { if (!childrenOf.has(par)) childrenOf.set(par, []); childrenOf.get(par).push(p.id); }
  const out = new Map();
  let frontier = new Set([id]);
  for (let gen = 1; gen <= maxGenerations && frontier.size; gen++) {
    const next = new Set();
    for (const cur of frontier) for (const c of childrenOf.get(cur) ?? []) next.add(c);
    for (const d of next) { if (!out.has(d)) out.set(d, new Set()); out.get(d).add(gen); }
    frontier = next;
  }
  return new Map([...out].map(([k, v]) => [k, [...v].sort((a, b) => a - b)]));
}

/**
 * The nearest common ancestors of a and b: [{ id, a, b }] with the generation on each side, nearest first.
 * "Nearest" = an ancestor that is not itself an ancestor of another common ancestor already found closer.
 */
export function commonAncestors(byId, aId, bId) {
  const A = ancestors(byId, aId), B = ancestors(byId, bId);
  if (A.has(bId) || B.has(aId)) return [];
  const all = [];
  for (const [id, ea] of A) if (B.has(id)) all.push({ id, a: ea.generations[0], b: B.get(id).generations[0] });
  all.sort((x, y) => x.a + x.b - (y.a + y.b) || (x.id < y.id ? -1 : 1));
  // drop ancestors of nearer common ancestors
  const nearest = [];
  for (const c of all) {
    const covered = nearest.some((n) => ancestors(byId, n.id).has(c.id));
    if (!covered) nearest.push(c);
  }
  return nearest;
}

/* ---------- labels ---------- */

const ORD = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
const ordinal = (n) => ORD[n] ?? `${n}th`;
const TIMES = ["", "once", "twice", "three times", "four times", "five times"];
const times = (n) => TIMES[n] ?? `${n} times`;
const sexed = (p, m, f, neutral) => (p?.sex === "M" ? m : p?.sex === "F" ? f : neutral);
const greats = (n) => (n <= 0 ? "" : n === 1 ? "great-" : `${n}× great-`);

/** Today's labels (kept exactly, reviewer decision): the first matching rule wins. */
function closeLabel(byId, f, p) {
  if (p.id === f.fatherId) return "father";
  if (p.id === f.motherId) return "mother";
  if ((f.spouseIds || []).includes(p.id)) return "spouse";
  if (p.fatherId === f.id || p.motherId === f.id) return "child";
  if ((p.fatherId && p.fatherId === f.fatherId) || (p.motherId && p.motherId === f.motherId)) return "sibling";
  const fF = byId[f.fatherId], fM = byId[f.motherId];
  if ((fF && (p.id === fF.fatherId || p.id === fF.motherId)) || (fM && (p.id === fM.fatherId || p.id === fM.motherId))) return "grandparent";
  const pF = byId[p.fatherId], pM = byId[p.motherId];
  if ((pF && (pF.fatherId === f.id || pF.motherId === f.id)) || (pM && (pM.fatherId === f.id || pM.motherId === f.id))) return "grandchild";
  return null;
}

/** Blood relation of p to f (or null). Includes "related twice" when the nearest common ancestors are on different lines. */
function bloodLabel(byId, f, p) {
  const Af = ancestors(byId, f.id);
  if (Af.has(p.id)) { const g = Af.get(p.id).generations[0]; return g >= 3 ? sexed(p, `${greats(g - 2)}grandfather`, `${greats(g - 2)}grandmother`, `${greats(g - 2)}grandparent`) : null; }
  const Ap = ancestors(byId, p.id);
  if (Ap.has(f.id)) { const g = Ap.get(f.id).generations[0]; return g >= 3 ? sexed(p, `${greats(g - 2)}grandson`, `${greats(g - 2)}granddaughter`, `${greats(g - 2)}grandchild`) : null; }
  const cas = commonAncestors(byId, f.id, p.id);
  if (!cas.length) return null;
  const { a, b } = cas[0];
  let label;
  if (a === 1 && b === 1) label = "sibling";
  else if (b === 1) label = sexed(p, `${greats(a - 2)}uncle`, `${greats(a - 2)}aunt`, `${greats(a - 2)}uncle/aunt`);
  else if (a === 1) label = sexed(p, `${greats(b - 2)}nephew`, `${greats(b - 2)}niece`, `${greats(b - 2)}nephew/niece`);
  else {
    const degree = Math.min(a, b) - 1, removed = Math.abs(a - b);
    label = `${ordinal(degree)} cousin${removed ? ` ${times(removed)} removed` : ""}`;
  }
  // count distinct lines: nearest common ancestors at the same distance, a couple counting as one line
  const best = cas.filter((c) => c.a + c.b === a + b);
  const lines = [];
  for (const c of best) {
    const partners = byId[c.id]?.spouseIds ?? [];
    if (!lines.some((l) => l.includes(c.id) || partners.some((s) => l.includes(s)))) lines.push([c.id]);
    else lines.find((l) => l.includes(c.id) || partners.some((s) => l.includes(s))).push(c.id);
  }
  return lines.length > 1 ? `${label}, related ${lines.length === 2 ? "twice" : `${lines.length} ways`}` : label;
}

/**
 * How `person` is related to `focus`. Today's labels first (father … grandchild, unchanged), then precise ones:
 * great-grandparents, uncles/aunts, nephews/nieces, cousins with degree and removal, step- and in-law relations,
 * "spouse of …" a blood relative; "relative" when no line is found.
 */
export function kinshipLabel(byId, focus, person) {
  if (!focus || !person || person.id === focus.id) return "";
  const close = closeLabel(byId, focus, person);
  if (close) return close;
  const blood = bloodLabel(byId, focus, person);
  if (blood) return blood;
  const f = focus, p = person;
  const parentsF = parentsOf(byId, f.id), spousesF = (f.spouseIds ?? []).filter((s) => byId[s]);
  // step relations
  if (parentsF.some((par) => (byId[par].spouseIds ?? []).includes(p.id))) return sexed(p, "stepfather", "stepmother", "step-parent");
  if (spousesF.some((s) => parentsOf(byId, p.id).includes(s))) return sexed(p, "stepson", "stepdaughter", "stepchild");
  // in-laws
  if (spousesF.some((s) => parentsOf(byId, s).includes(p.id))) return sexed(p, "father-in-law", "mother-in-law", "parent-in-law");
  if ((p.spouseIds ?? []).some((s) => parentsOf(byId, s).includes(f.id))) return sexed(p, "son-in-law", "daughter-in-law", "child-in-law");
  const siblingsOf = (id) => Object.values(byId).filter((x) => x.id !== id && parentsOf(byId, x.id).some((par) => parentsOf(byId, id).includes(par))).map((x) => x.id);
  if (spousesF.some((s) => siblingsOf(s).includes(p.id)) || siblingsOf(f.id).some((sib) => (byId[sib].spouseIds ?? []).includes(p.id))) return sexed(p, "brother-in-law", "sister-in-law", "sibling-in-law");
  // spouse of a blood relative
  for (const s of (p.spouseIds ?? []).filter((x) => byId[x])) {
    const rel = closeLabel(byId, f, byId[s]) ?? bloodLabel(byId, f, byId[s]);
    if (rel && rel !== "spouse") return `${sexed(p, "husband", "wife", "spouse")} of ${/^(father|mother|child|sibling)$/.test(rel) ? "the " : ""}${rel}`;
  }
  return "relative";
}
