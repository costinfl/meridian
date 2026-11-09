/*
 * Families: the source of truth for parents and spouses (evidence-model.md, Layer 4).
 *   { id, partner1Id, partner2Id, children: [{ personId, order }], marriage: { date, placeText },
 *     status, rationale }
 * `partner1Id` fills the `fatherId` slot and `partner2Id` the `motherId` slot of the legacy person
 * fields (same convention as the GEDCOM HUSB/WIFE export); either may be null (unknown).
 * `fatherId`, `motherId` and `spouseIds` on people are DERIVED from families by normalizeProject so
 * existing components, relationship inference and GEDCOM export keep working unchanged (invariant I8).
 * Pure functions: nothing here touches storage or the evidence library.
 */

const key = (a, b) => `${a || ""}|${b || ""}`;
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

export function createFamily({ partner1Id = null, partner2Id = null, children = [], marriage = null, status = "accepted", rationale = "" } = {}) {
  return {
    id: crypto.randomUUID(),
    partner1Id: partner1Id || null,
    partner2Id: partner2Id || null,
    children: children.map((c, i) => ({ personId: c.personId ?? c, order: c.order ?? i })),
    marriage: marriage ?? { date: null, placeText: "" },
    status,
    rationale,
  };
}

/** Build families from the legacy fields. Order mirrors the GEDCOM export: parent pairs first, then childless couples. */
export function buildFamilies(people) {
  const byKey = new Map();
  const make = (p1, p2, rationale) => {
    const f = createFamily({ partner1Id: p1, partner2Id: p2, rationale });
    byKey.set(key(p1, p2), f);
    return f;
  };
  for (const p of people ?? []) {
    if (p.fatherId || p.motherId) {
      const f = byKey.get(key(p.fatherId, p.motherId)) ?? make(p.fatherId, p.motherId, "Built from legacy fatherId/motherId");
      f.children.push({ personId: p.id, order: f.children.length });
    }
  }
  for (const p of people ?? []) {
    for (const s of p.spouseIds ?? []) {
      const a = p.sex === "F" ? s : p.id, b = p.sex === "F" ? p.id : s;
      if (byKey.has(key(a, b)) || byKey.has(key(b, a))) continue; // one family per couple
      make(a, b, "Built from legacy spouseIds");
    }
  }
  return [...byKey.values()];
}

/**
 * Return people with fatherId / motherId / spouseIds derived from `families`.
 * Values are only replaced when they differ (null and undefined count as equal; a spouse array is kept
 * as is when it already holds the same people), so an untouched project is returned unchanged.
 */
export function derivePeopleFromFamilies(people, families) {
  let changed = false;
  const out = (people ?? []).map((p) => {
    const childOf = families.find((f) => f.children.some((c) => c.personId === p.id));
    const father = childOf ? childOf.partner1Id ?? null : null;
    const mother = childOf ? childOf.partner2Id ?? null : null;
    const spouses = [];
    for (const f of families) {
      const other = f.partner1Id === p.id ? f.partner2Id : f.partner2Id === p.id ? f.partner1Id : undefined;
      if (other && !spouses.includes(other)) spouses.push(other);
    }
    const existing = p.spouseIds ?? [];
    const spouseIds = sameSet(existing, spouses) ? existing : spouses;
    const patch = {};
    if ((p.fatherId ?? null) !== father) patch.fatherId = father;
    if ((p.motherId ?? null) !== mother) patch.motherId = mother;
    if (spouseIds !== existing || (p.spouseIds === undefined && spouseIds.length)) patch.spouseIds = spouseIds;
    if (!Object.keys(patch).length) return p;
    changed = true;
    return { ...p, ...patch };
  });
  return changed ? out : people;
}

/* ---------- family functions: the way parents and spouses are edited ---------- */

const withFamilies = (project, families) => {
  const people = derivePeopleFromFamilies(project.people, families);
  return { ...project, families, people };
};

/** Set (or clear) the parents of a child. Removes the child from its previous family; drops families left empty. */
export function setParents(project, childId, { fatherId = null, motherId = null } = {}) {
  let families = (project.families ?? []).map((f) => ({ ...f, children: f.children.filter((c) => c.personId !== childId) }));
  if (fatherId || motherId) {
    const target = families.find((f) => (f.partner1Id ?? null) === (fatherId || null) && (f.partner2Id ?? null) === (motherId || null));
    if (target) target.children = [...target.children, { personId: childId, order: target.children.length }];
    else families = [...families, createFamily({ partner1Id: fatherId, partner2Id: motherId, children: [childId], rationale: "Parents set by the researcher" })];
  }
  families = families.filter((f) => f.children.length || (f.partner1Id && f.partner2Id)); // keep couples, drop empty single-parent shells
  return withFamilies(project, families);
}

/** Record that two people are partners (creates a childless family unless one exists). */
export function addPartners(project, personAId, personBId) {
  const families = project.families ?? [];
  if (families.some((f) => (f.partner1Id === personAId && f.partner2Id === personBId) || (f.partner1Id === personBId && f.partner2Id === personAId))) return project;
  const a = (project.people ?? []).find((p) => p.id === personAId);
  const [p1, p2] = a?.sex === "F" ? [personBId, personAId] : [personAId, personBId];
  return withFamilies(project, [...families, createFamily({ partner1Id: p1, partner2Id: p2, rationale: "Partners set by the researcher" })]);
}

/** Remove the partnership between two people; their shared children stay with the family as a single-parent family. */
export function removePartners(project, personAId, personBId) {
  const families = (project.families ?? []).flatMap((f) => {
    const pair = (f.partner1Id === personAId && f.partner2Id === personBId) || (f.partner1Id === personBId && f.partner2Id === personAId);
    if (!pair) return [f];
    return f.children.length ? [{ ...f, partner2Id: null, rationale: `${f.rationale} (partnership removed)`.trim() }] : [];
  });
  return withFamilies(project, families);
}
