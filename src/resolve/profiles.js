// Entity resolution profiles (P9.T1): what is known about a persona (one person as described in one record) and
// about a tree person, in one comparable shape. Pure: the caller passes the library snapshot and the project data
// (people, families, current links). Values come from live assertions, proposed or confirmed (reviewer decision);
// rejected and superseded ones are left out, and a profile notes when it rests on proposed values.
import { prepareRecords, recordPart } from "../graph/projection.js";
import { nameTokens, dmCodesOfName, searchKey } from "../evidence/domain/normalize.js";
import { fromStatedAge, toJdn } from "../evidence/domain/fuzzyDate.js";

export const YEAR_DAYS = 365.2425;
const years = (n) => Math.round(n * YEAR_DAYS);
const yearRange = (y) => [toJdn(y, 1, 1), toJdn(y, 12, 31)];

const MALE_ROLES = new Set(["father", "groom", "priest"]);
const FEMALE_ROLES = new Set(["mother", "bride"]);
const SEX_OF = { male: "M", female: "F", m: "M", f: "F", M: "M", F: "F" };

/** Split a folded name into tokens, the surname (last token) and given names (the rest). Maiden names "(b. X)" / "(n. X)" count as extra surnames. */
export function splitName(name) {
  const raw = String(name ?? "");
  const maiden = [...raw.matchAll(/\((?:b|n|născută|nascuta|née|nee)\.?\s+([^)]+)\)/gi)].map((m) => nameTokens(m[1])).flat();
  const tokens = nameTokens(raw.replace(/\([^)]*\)/g, " "));
  const surname = tokens.length > 1 ? tokens[tokens.length - 1] : null;
  const given = tokens.length > 1 ? tokens.slice(0, -1) : tokens;
  return { tokens, given, surnames: [surname, ...maiden].filter(Boolean) };
}

const dmOf = (tokens) => [...new Set(tokens.flatMap((t) => dmCodesOfName(t)))];

/** The role-based birth window for a persona (days), when nothing better is stated. */
function roleBirthWindow(role, kind, e0, e1) {
  if (role === "child" && (kind === "baptism" || kind === "birth")) return [e0 - years(2), e1];
  if (role === "deceased") return [e1 - years(110), e1];
  if (role === "groom" || role === "bride") return [e0 - years(70), e1 - years(14)];
  if (role === "father" || role === "mother") return [e0 - years(75), e1 - years(14)];
  if (role === "child") return [e0 - years(60), e1];
  return [e0 - years(90), e1 - years(14)];
}

/**
 * Profiles of every persona in the snapshot: Map personaId -> profile.
 * profile: { id, recordId, kind, role, name, given, surnames, dm, surnameDm, sex, birth: [d0,d1]|null, death, alive,
 *            placeId, places: [text], relatives: [{ relation, personaId, name, given, surnames }], others: [personaId],
 *            usesProposed, nameAsWritten }
 */
export function personaProfiles(snapshot) {
  const ctx = prepareRecords(snapshot);
  const out = new Map();
  for (const rec of ctx.records.values()) {
    const part = recordPart(ctx, rec.id);
    if (!part) continue;
    const e0 = part.record.earliestDay, e1 = part.record.latestDay;
    const recAssertions = ctx.assertionsBySubject.get(rec.id) ?? [];
    const recProposed = recAssertions.some((a) => a.status === "proposed" && (a.property === "event.date" || a.property === "event.place"));
    const personas = ctx.personasByRecord.get(rec.id) ?? [];
    const base = new Map();
    for (const p of personas) {
      const as = ctx.assertionsBySubject.get(p.id) ?? [];
      const pick = (prop) => {
        const list = as.filter((a) => a.property === prop && !a.objectPersonaId);
        return list.find((a) => a.status === "confirmed") ?? list[list.length - 1] ?? null;
      };
      let proposed = recProposed;
      const used = (a) => { if (a?.status === "proposed") proposed = true; return a; };
      const nameA = used(pick("name"));
      const name = nameA?.originalValue || p.nameAsWritten;
      const sexA = used(pick("sex"));
      const sex = SEX_OF[sexA?.originalValue?.trim?.()] ?? (MALE_ROLES.has(p.role) ? "M" : FEMALE_ROLES.has(p.role) ? "F" : null);
      // birth: stated date, else stated age at the event, else the role
      let birth = null;
      const bd = used(pick("birth.date"));
      if (Number.isInteger(bd?.normalizedValue?.earliestDay)) birth = [bd.normalizedValue.earliestDay, bd.normalizedValue.latestDay];
      const ageA = pick("age");
      const age = ageA?.normalizedValue ?? p.statedAge;
      if (!birth && age && e0 != null && e1 != null) {
        try {
          const r = fromStatedAge({ value: age.value, unit: age.unit ?? "years", slack: (age.unit ?? "years") === "years" ? 1 : 0 }, { earliestDay: e0, latestDay: e1, calendar: rec.event?.calendar ?? "gregorian" });
          birth = [r.earliestDay, r.latestDay]; used(ageA);
        } catch { /* an unusable age */ }
      }
      if (!birth && e0 != null && e1 != null) birth = roleBirthWindow(p.role, rec.kind, e0, e1);
      const dd = used(pick("death.date"));
      let death = Number.isInteger(dd?.normalizedValue?.earliestDay) ? [dd.normalizedValue.earliestDay, dd.normalizedValue.latestDay] : null;
      if (!death && p.role === "deceased" && e0 != null) death = rec.kind === "burial" ? [e0 - 30, e1] : [e0 - 3, e1];
      const alive = p.role !== "deceased" && e0 != null ? [e0, e1] : null;      // named as present: alive at the event
      const places = [part.record.placeText, pick("residence")?.originalValue, p.residence, pick("birth.place")?.originalValue].filter(Boolean);
      const occupation = pick("occupation")?.originalValue || p.occupation || "";
      const n = splitName(name);
      base.set(p.id, {
        id: p.id, recordId: rec.id, kind: rec.kind, role: p.role, nameAsWritten: p.nameAsWritten, name, occupations: occupation ? [occupation] : [],
        given: n.given, surnames: n.surnames, tokens: n.tokens, sex, birth, death, alive,
        placeId: rec.placeId ?? null, places, usesProposed: proposed, relatives: [], others: personas.filter((x) => x.id !== p.id).map((x) => x.id),
        _as: as,
      });
    }
    // relatives inside the record: relation assertions first, then the usual roles
    const rel = (from, relation, to) => { const a = base.get(from), b = base.get(to); if (a && b && !a.relatives.some((r) => r.personaId === to)) a.relatives.push({ relation, personaId: to }); };
    for (const prof of base.values()) {
      for (const a of prof._as) {
        if (!a.objectPersonaId || !base.has(a.objectPersonaId)) continue;
        if (a.status === "proposed") prof.usesProposed = true;
        const other = base.get(a.objectPersonaId);
        if (a.property === "childOf") { rel(prof.id, other.sex === "F" ? "mother" : other.sex === "M" ? "father" : "parent", other.id); rel(other.id, "child", prof.id); }
        else if (a.property === "parentOf") { rel(prof.id, "child", other.id); rel(other.id, prof.sex === "F" ? "mother" : prof.sex === "M" ? "father" : "parent", prof.id); }
        else if (a.property === "spouseOf") { rel(prof.id, "spouse", other.id); rel(other.id, "spouse", prof.id); }
      }
    }
    const byRole = (r) => [...base.values()].filter((x) => x.role === r);
    if (rec.kind === "baptism" || rec.kind === "birth") {
      for (const c of byRole("child")) {
        for (const f of byRole("father")) { rel(c.id, "father", f.id); rel(f.id, "child", c.id); }
        for (const m of byRole("mother")) { rel(c.id, "mother", m.id); rel(m.id, "child", c.id); }
      }
      for (const f of byRole("father")) for (const m of byRole("mother")) { rel(f.id, "spouse", m.id); rel(m.id, "spouse", f.id); }
    }
    if (rec.kind === "marriage") for (const g of byRole("groom")) for (const b of byRole("bride")) { rel(g.id, "spouse", b.id); rel(b.id, "spouse", g.id); }
    // a child named without a surname takes the father's (common in baptisms: "Ion"); a wife named without one, her
    // husband's ("Maria, soția sa"): both are kept as borrowed, so a mismatch on them counts less
    for (const prof of base.values()) {
      if (prof.surnames.length) continue;
      const father = prof.relatives.find((r) => r.relation === "father");
      const husband = prof.sex !== "M" ? prof.relatives.find((r) => r.relation === "spouse") : null;
      const fs = father ? base.get(father.personaId).surnames[0] : null;
      const hs = husband ? base.get(husband.personaId).surnames[0] : null;
      if (fs) { prof.surnames = [fs]; prof.surnameFrom = "father"; }
      else if (hs) { prof.surnames = [hs]; prof.surnameFrom = "husband"; }
    }
    for (const prof of base.values()) {
      prof.relatives = prof.relatives.map((r) => { const o = base.get(r.personaId); return { ...r, name: o.name, given: o.given, surnames: o.surnames }; });
      prof.dm = dmOf(prof.tokens);
      prof.surnameDm = dmOf(prof.surnames);
      delete prof._as;
      out.set(prof.id, prof);
    }
  }
  return out;
}

/**
 * Profiles of the tree's persons: Map personId -> profile, same fields where they apply, plus
 * { parents, spouses, children (ids), linkedPersonaIds (accepted) }. Names of accepted personas are added as
 * alternative names, so a person known as "Ioan" in one record and "Iohannes" in another matches both.
 */
export function personProfiles({ people = [], families = [], links = [], personaProfiles: pp = new Map(), displayName = (p) => p.name ?? "" }) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const parents = new Map(), children = new Map(), spouses = new Map();
  const add = (m, k, v) => { if (!m.has(k)) m.set(k, []); if (!m.get(k).includes(v)) m.get(k).push(v); };
  for (const f of families) {
    if (f.status && f.status !== "accepted") continue;
    const ps = [f.partner1Id, f.partner2Id].filter(Boolean);
    if (ps.length === 2) { add(spouses, ps[0], ps[1]); add(spouses, ps[1], ps[0]); }
    for (const c of f.children ?? []) for (const p of ps) { add(parents, c.personId, p); add(children, p, c.personId); }
  }
  const accepted = new Map();
  for (const l of links) if (l.status === "accepted") add(accepted, l.personId, l.personaId);
  const out = new Map();
  for (const p of people) {
    const name = displayName(p);
    const n = splitName(name);
    const alt = (accepted.get(p.id) ?? []).map((id) => pp.get(id)).filter(Boolean);
    const tokens = [...new Set([...n.tokens, ...alt.flatMap((a) => a.tokens)])];
    const given = [...new Set([...n.given, ...alt.flatMap((a) => a.given)])];
    // a married woman is written under her husband's surname in many records
    const spouseIds = spouses.get(p.id) ?? (p.spouseIds ?? []);
    // (the husband's, or else the children's when the husband is not in the tree)
    // (a child's birth surname: a married daughter's maiden name in brackets, not her married name)
    const birthSurname = (x) => { const sn = splitName(displayName(x)).surnames; return sn.length > 1 ? sn[sn.length - 1] : sn[0]; };
    const married = SEX_OF[p.sex] === "F"
      ? [...spouseIds.map((id) => byId.get(id)).filter(Boolean).map((h) => splitName(displayName(h)).surnames[0]),
         ...(children.get(p.id) ?? []).map((id) => byId.get(id)).filter(Boolean).map(birthSurname)].filter(Boolean)
      : [];
    const surnames = [...new Set([...n.surnames, ...alt.flatMap((a) => a.surnames), ...married])];
    const by = p.birth?.year, dy = p.death?.year;
    const birth = by ? yearRange(by) : dy ? [yearRange(dy)[0] - years(110), yearRange(dy)[1]] : null;
    const death = dy ? yearRange(dy) : null;
    const birthFrom = by ? "stated" : dy ? "death" : null;
    out.set(p.id, {
      id: p.id, name, given, surnames, tokens, sex: SEX_OF[p.sex] ?? null, birth, death, birthFrom,
      places: [p.birth?.place, p.death?.place].filter(Boolean),
      occupations: (p.periods ?? []).map((r) => r.label).filter(Boolean),
      parents: parents.get(p.id) ?? [p.fatherId, p.motherId].filter((x) => x && byId.has(x)),
      spouses: spouses.get(p.id) ?? (p.spouseIds ?? []).filter((x) => byId.has(x)),
      children: children.get(p.id) ?? [],
      linkedPersonaIds: accepted.get(p.id) ?? [],
      dm: dmOf(tokens), surnameDm: dmOf(surnames),
    });
  }
  // no birth year: a window from the relatives' years (a parent 15–50 years older, a child 15–50 younger, a spouse
  // within 15 years), so a person without dates can still be told from a namesake born a century apart
  for (const q of out.values()) {
    if (q.birthFrom === "stated") continue;
    const by = (id) => byId.get(id)?.birth?.year;
    const lo = [], hi = [];
    for (const id of q.parents) if (by(id)) { lo.push(by(id) + 15); hi.push(by(id) + 50); }
    for (const id of q.children) if (by(id)) { lo.push(by(id) - 50); hi.push(by(id) - 15); }
    for (const id of q.spouses) if (by(id)) { lo.push(by(id) - 15); hi.push(by(id) + 15); }
    if (!lo.length) continue;
    let a = Math.max(...lo), b = Math.min(...hi);
    if (a > b) { a = Math.min(...lo); b = Math.max(...hi); }              // relatives disagree: the widest window
    const r = [toJdn(a, 1, 1), toJdn(b, 12, 31)];
    q.birth = q.birth ? [Math.max(q.birth[0], r[0]), Math.min(q.birth[1], r[1])] : r;
    if (q.birth[0] > q.birth[1]) q.birth = r;
    q.birthFrom = "relatives";
  }
  return out;
}

/**
 * A draft tree person from one or more persona profiles (for "Create new person"): the fullest name (one with a
 * surname, most words), the sex if they agree, a birth year when some window is narrow (5 years or less: its middle),
 * a death year from a death record. Nothing is invented beyond that.
 */
export function personDraft(profiles) {
  const list = profiles.filter(Boolean);
  const named = [...list].sort((a, b) => (b.surnames.length && !b.surnameFrom) - (a.surnames.length && !a.surnameFrom) || b.tokens.length - a.tokens.length);
  const best = named[0];
  let name = best?.name ?? "";
  if (best && best.tokens.length === 1 && best.surnames[0]) name = `${best.name} ${best.surnames[0].charAt(0).toUpperCase()}${best.surnames[0].slice(1)}`;
  const sexes = new Set(list.map((p) => p.sex).filter(Boolean));
  const yearOf = (day) => Math.round(1 + (day - toJdn(1, 1, 1)) / YEAR_DAYS);
  const narrow = list.map((p) => p.birth).filter((b) => b && b[1] - b[0] <= 5 * YEAR_DAYS).sort((a, b) => (a[1] - a[0]) - (b[1] - b[0]))[0];
  const death = list.map((p) => (p.role === "deceased" ? p.death : null)).find(Boolean);
  return {
    name, sex: sexes.size === 1 ? [...sexes][0] : "U",
    birthYear: narrow ? yearOf((narrow[0] + narrow[1]) / 2) : null,
    deathYear: death ? yearOf(death[1]) : null,
  };
}
