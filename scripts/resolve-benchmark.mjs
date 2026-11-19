// Entity resolution benchmark (Phase 9): a synthetic population with known answers (couples over five generations,
// records written from it with spelling noise, missing surnames, stated ages off by a year; 60% of the people in the
// tree), then one full matching run. Prints timing, pair counts, precision and recall of the best proposal, and the
// share of right proposals per score band. Usage: node scripts/resolve-benchmark.mjs [scale=1] [seed=7]
// (DIAG=1 lists wrong proposals scoring 0.90+, MISS=1 why true pairs were missed).
const root = new URL("..", import.meta.url).pathname.replace(/\/$/, ""), SCALE = Number(process.argv[2] ?? 1), SEED = Number(process.argv[3] ?? 7);
const { findMatches } = await import(root + "/src/resolve/run.js");
const { toJdn } = await import(root + "/src/evidence/domain/fuzzyDate.js");
let s = SEED; const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const SUR = ["Hariton","Popescu","Ionescu","Dumitrescu","Stan","Marin","Văleanu","Băltăceanu","Cristescu","Drăgoiescu","Georgescu","Constantinescu","Radu","Neagu","Tudor","Dinu","Ene","Matei","Preda","Mihai","Stoica","Barbu","Nistor","Lazăr","Oprea","Toma","Vasilescu","Florea","Sandu","Petrescu","Moldovan","Ilie","Gheorghiu","Manole","Diaconu","Popa","Rusu","Munteanu","Zamfir","Cojocaru"];
const GM = ["Ion","Gheorghe","Dumitru","Vasile","Constantin","Nicolae","Petre","Mihai","Alexandru","Ilie","Stan","Radu","Toma","Matei","Costache","Iordache","Grigore","Anghel","Tudor","Marin"];
const GF = ["Maria","Ana","Elena","Ioana","Floarea","Stanca","Rada","Safta","Zoița","Smaranda","Ecaterina","Paraschiva","Niculina","Despina","Tudora","Marița","Anica","Joița","Sultana","Ilinca"];
const VARIANT = { Ion: ["Ioan", "Iohannes"], Gheorghe: ["Gheorghie", "Georgie"], Dumitru: ["Dumitrache", "Demetrius"], Vasile: ["Vasilie"], Constantin: ["Constandin", "Costandin"], Nicolae: ["Neculae", "Nicolai"], Petre: ["Petru"], Elena: ["Ileana"], Maria: ["Mariia"], Ecaterina: ["Catrina"] };
const noisy = (given, sur) => {
  let g = given, n = sur;
  if (VARIANT[g] && rnd() < 0.15) g = pick(VARIANT[g]);
  if (n && rnd() < 0.15) n = n.endsWith("u") ? n.slice(0, -1) : n + "u";
  if (n && rnd() < 0.05) { const i = 1 + Math.floor(rnd() * (n.length - 2)); n = n.slice(0, i) + n[i + 1] + n[i] + n.slice(i + 2); }
  return [g, n];
};
// population: generations of couples
const people = []; let pid = 0;
const mk = (sex, sur, by, father = null, mother = null) => { const p = { id: "q" + pid++, sex, given: sex === "M" ? pick(GM) : pick(GF), sur, by, dy: by + 25 + Math.floor(rnd() * 55), father, mother, spouse: null, kids: [] }; people.push(p); return p; };
let gen = [];
for (let i = 0; i < 40 * SCALE; i++) { const h = mk("M", pick(SUR), 1760 + Math.floor(rnd() * 20)); const w = mk("F", pick(SUR), h.by + Math.floor(rnd() * 8)); h.spouse = w.id; w.spouse = h.id; gen.push([h, w]); }
for (let g = 0; g < 4; g++) {
  const next = [];
  for (const [h, w] of gen) {
    const n = 2 + Math.floor(rnd() * 4);
    for (let k = 0; k < n; k++) {
      const by = Math.max(h.by, w.by) + 20 + k * 2 + Math.floor(rnd() * 2);
      if (by > Math.min(h.dy, w.dy + 0) || by > w.by + 45) break;
      const c = mk(rnd() < 0.5 ? "M" : "F", h.sur, by, h.id, w.id); h.kids.push(c.id); w.kids.push(c.id);
      if (c.dy - c.by > 22 && rnd() < 0.8) {
        const sp = mk(c.sex === "M" ? "F" : "M", pick(SUR), c.by + Math.floor(rnd() * 8) - 4);
        sp.dy = Math.max(sp.dy, c.by + 30); c.spouse = sp.id; sp.spouse = c.id;
        next.push(c.sex === "M" ? [c, sp] : [sp, c]);
      }
    }
  }
  gen = next;
}
const P = new Map(people.map((p) => [p.id, p]));
// records written from the population
const T = "2026-01-01T00:00:00.000Z";
const snap = { sources: [{ id: "s", title: "S", createdAt: T }], copies: [{ id: "c", sourceId: "s", fileName: "r.pdf", createdAt: T }], pages: [], regions: [], records: [], personas: [], assertions: [], decisions: [], nameVariants: [] };
const truth = new Map(); let rid = 0, aid = 0;
const day = (y, m = 6, d = 15) => toJdn(y, m, d, "julian");
const record = (kind, year, ps) => {
  const r = "r" + rid++; snap.pages.push({ id: "pg" + r, copyId: "c", pageIndex: rid, createdAt: T }); snap.regions.push({ id: "rg" + r, pageId: "pg" + r, kind: "page", createdAt: T });
  const e = day(year, 1 + Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 28));
  snap.records.push({ id: r, kind, regionIds: ["rg" + r], event: { earliestDay: e, latestDay: e, calendar: "julian" }, createdAt: T });
  for (const [role, person, opts = {}] of ps) {
    if (!person) continue;
    const [g, n] = noisy(person.given, opts.noSurname ? "" : opts.surname ?? person.sur);
    const id = `pa${aid++}`;
    snap.personas.push({ id, recordId: r, nameAsWritten: `${g}${n ? " " + n : ""}`, role, statedAge: opts.age != null ? { value: opts.age, unit: "years", slack: 0, asWritten: "" } : null, createdAt: T });
    truth.set(id, person.id);
  }
};
const ageAt = (p, y) => Math.max(0, y - p.by + (rnd() < 0.3 ? (rnd() < 0.5 ? -1 : 1) : 0));
const other = () => pick(people);
for (const p of people) {
  const f = P.get(p.father), m = P.get(p.mother);
  if (f && rnd() < 0.85) { const gp = other(); record("baptism", p.by, [["child", p, { noSurname: rnd() < 0.7 }], ["father", f], ["mother", m, { noSurname: rnd() < 0.6, surname: f.sur }], ["godparent", gp.by < p.by - 16 ? gp : null]]); }
  const sp = P.get(p.spouse);
  if (sp && p.sex === "M" && rnd() < 0.75) { const y = Math.max(p.by, sp.by) + 20 + Math.floor(rnd() * 5); if (y < Math.min(p.dy, sp.dy)) { const wit = other(); record("marriage", y, [["groom", p, { age: ageAt(p, y) }], ["bride", sp, { age: ageAt(sp, y) }], ["witness", wit.by < y - 18 && wit.dy > y ? wit : null]]); } }
  if (p.dy < 1900 && rnd() < 0.7) { const kid = p.kids.map((k) => P.get(k)).find((k) => k.dy > p.dy && p.dy - k.by > 18); record("death", p.dy, [["deceased", p, { age: ageAt(p, p.dy), surname: p.sex === "F" && sp ? P.get(p.spouse).sur : p.sur }], ["informant", kid ?? null, { age: kid ? ageAt(kid, p.dy) : null }]]); }
}
// the tree: 60% of the population (the rest are people the researcher has not found)
const inTree = new Set(people.filter(() => rnd() < 0.6).map((p) => p.id));
const treePeople = people.filter((p) => inTree.has(p.id)).map((p) => ({ id: p.id, name: `${p.given} ${p.sur}`, sex: p.sex, birth: rnd() < 0.85 ? { year: p.by } : {}, death: p.dy < 1900 && rnd() < 0.6 ? { year: p.dy } : {} }));
const families = [];
for (const p of people) if (p.sex === "M" && p.spouse) {
  const a = inTree.has(p.id) ? p.id : null, b = inTree.has(p.spouse) ? p.spouse : null;
  const kids = p.kids.filter((k) => inTree.has(k));
  if ((a && b) || ((a || b) && kids.length)) families.push({ id: "f" + p.id, partner1Id: a, partner2Id: b, children: kids.map((k, i) => ({ personId: k, order: i })), status: "accepted" });
}
const t0 = Date.now();
const r = findMatches({ snapshot: snap, people: treePeople, families, links: [], displayName: (p) => p.name });
const ms = Date.now() - t0;
// quality: per persona, the best proposal
const best = new Map();
for (const x of r.proposals) if (!best.has(x.personaId) || best.get(x.personaId).score < x.score) best.set(x.personaId, x);
const any = new Map(); for (const x of r.proposals) { if (!any.has(x.personaId)) any.set(x.personaId, new Set()); any.get(x.personaId).add(x.personId); }
let tp = 0, fp = 0, fn = 0, findable = 0, inTop3 = 0, fpNotInTree = 0;
const bands = { "0.9": [0, 0], "0.8": [0, 0], "0.7": [0, 0] };
for (const pa of snap.personas) {
  const t = truth.get(pa.id), b = best.get(pa.id);
  const should = inTree.has(t);
  if (should) findable++;
  if (b) {
    const ok = b.personId === t; ok ? tp++ : fp++; if (!ok && !should) fpNotInTree++;
    const band = b.score >= 0.9 ? "0.9" : b.score >= 0.8 ? "0.8" : "0.7"; bands[band][0]++; if (ok) bands[band][1]++;
  } else if (should) fn++;
  if (should && any.get(pa.id)?.has(t)) inTop3++;
}
if (process.env.DIAG) {
  const role = new Map(snap.personas.map((x) => [x.id, x.role])); const name = new Map(snap.personas.map((x) => [x.id, x.nameAsWritten]));
  const byRole = {}; let shown = 0;
  for (const pa of snap.personas) { const b = best.get(pa.id); if (!b || b.personId === truth.get(pa.id) || b.score < 0.9) continue;
    const k = role.get(pa.id) + (inTree.has(truth.get(pa.id)) ? ":inTree" : ":notInTree"); byRole[k] = (byRole[k] ?? 0) + 1;
    const corr = (b.signals.date >= 0.85 ? "D" : "") + (b.signals.relatives >= 0.8 ? "R" : "") + (b.signals.fan >= 1 ? "F" : "");
    byRole["corr:" + corr] = (byRole["corr:" + corr] ?? 0) + 1;
    if (shown++ < 8) { const t = P.get(truth.get(pa.id)), q = P.get(b.personId); console.log(role.get(pa.id), name.get(pa.id), "| true", t.given, t.sur, t.by, "| proposed", q.given, q.sur, q.by, "rel(true,prop):", t.father === q.father ? "siblings" : t.id === q.spouse ? "spouses" : "-", JSON.stringify(b.signals)); } }
  console.log(JSON.stringify(byRole));
}
if (process.env.MISS) {
  const { personaProfiles, personProfiles } = await import(root + "/src/resolve/profiles.js");
  const { blockKeys, datesCompatible } = await import(root + "/src/resolve/blocking.js");
  const { comparePair } = await import(root + "/src/resolve/compare.js");
  const { scorePair } = await import(root + "/src/resolve/score.js");
  const pp = personaProfiles(snap), qp = personProfiles({ people: treePeople, families, links: [], personaProfiles: pp, displayName: (p) => p.name });
  const why = {}; const ctx = { persons: qp, personas: pp, acceptedPersonOf: new Map() };
  const add = (k) => (why[k] = (why[k] ?? 0) + 1);
  for (const pa of snap.personas) {
    const t = truth.get(pa.id); if (!inTree.has(t) || any.get(pa.id)?.has(t)) continue;
    const a = pp.get(pa.id), q = qp.get(t);
    const ka = new Set(blockKeys(a)); const shared = blockKeys(q).some((k) => ka.has(k));
    if (!shared) { add(pa.role + ":notBlocked" + (a.surnames.length ? "" : ":noSurname")); continue; }
    if (!datesCompatible(a.birth, q.birth, 10)) { add(pa.role + ":dates"); continue; }
    const c = comparePair(a, q, ctx); const sc = scorePair(c);
    if (c.veto) { add(pa.role + ":veto:" + c.veto); continue; }
    if (sc >= 0.7) { add(pa.role + ":scoredOK-but-not-top3"); continue; }
    add(pa.role + ":low" + (sc === 0.65 ? ":uncorroborated" : ""));
  }
  console.log(JSON.stringify(Object.fromEntries(Object.entries(why).sort((x, y) => y[1] - x[1]))));
}
// groups: are grouped personas the same person?
let gPairs = 0, gGood = 0;
for (const g of r.groups) for (let i = 0; i < g.personaIds.length; i++) for (let j = i + 1; j < g.personaIds.length; j++) { gPairs++; if (truth.get(g.personaIds[i]) === truth.get(g.personaIds[j])) gGood++; }
console.log(JSON.stringify({
  population: people.length, treePersons: treePeople.length, records: snap.records.length, personas: snap.personas.length, ms,
  counts: { rawPairs: r.counts.rawPairs, personPairs: r.counts.personPairs, personaPairs: r.counts.personaPairs, proposed: r.counts.proposed, groups: r.counts.groups },
  precisionTop1: +(tp / (tp + fp)).toFixed(3), recallTop1: +(tp / findable).toFixed(3), recallTop3: +(inTop3 / findable).toFixed(3), wrongTop1: fp, wrongWhenNotInTree: fpNotInTree,
  bands: Object.fromEntries(Object.entries(bands).map(([k, [n, ok]]) => [k, `${ok}/${n}`])), groupPairPrecision: gPairs ? +(gGood / gPairs).toFixed(3) : null, groupPairs: gPairs,
}));
