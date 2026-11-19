/*
 * Editing a person's family in the app (Phase 9 review, d): name and sex, father, mother, spouses, children.
 * Families stay the source of truth (setParents / addPartners / removePartners in families.js); the legacy fields on
 * people are derived from them. Pure functions on the project object.
 */
import { setParents, addPartners, removePartners } from "./families.js";

const byIdOf = (project) => Object.fromEntries((project.people ?? []).map((p) => [p.id, p]));

/** A new person with just a name (and sex). Returns { project, person }. */
export function createPerson(project, { name, sex = "U" } = {}) {
  const clean = String(name ?? "").trim();
  if (!clean) throw new Error("A new person needs a name");
  const person = { id: `p_${crypto.randomUUID().slice(0, 8)}`, name: clean, sex, birth: {}, death: {}, events: [], periods: [], groups: [], media: [], spouseIds: [] };
  return { project: { ...project, people: [...(project.people ?? []), person] }, person };
}

export function updatePersonBasics(project, personId, { name, sex }) {
  return { ...project, people: (project.people ?? []).map((p) => (p.id !== personId ? p : { ...p, ...(name != null ? { name: String(name).trim() || p.name } : {}), ...(sex ? { sex } : {}) })) };
}

/** True when `ancestorId` is `personId` or one of their descendants would become their ancestor (a loop). */
export function wouldLoop(project, personId, newParentId) {
  if (!newParentId) return false;
  if (newParentId === personId) return true;
  const byId = byIdOf(project);
  // is personId an ancestor of newParentId?
  const seen = new Set();
  const stack = [newParentId];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    const p = byId[id];
    for (const par of [p?.fatherId, p?.motherId]) {
      if (!par) continue;
      if (par === personId) return true;
      stack.push(par);
    }
  }
  return false;
}

/** Set one parent (role "father" or "mother"), keeping the other. Null clears it. Throws on a loop. */
export function setParent(project, childId, role, parentId) {
  const child = byIdOf(project)[childId];
  if (!child) throw new Error(`No person ${childId}`);
  if (wouldLoop(project, childId, parentId)) throw new Error("That would make a person their own ancestor");
  const fatherId = role === "father" ? parentId || null : child.fatherId ?? null;
  const motherId = role === "mother" ? parentId || null : child.motherId ?? null;
  return setParents(project, childId, { fatherId, motherId });
}

export function addSpouse(project, personId, spouseId) {
  if (!spouseId || spouseId === personId) throw new Error("Choose another person");
  return addPartners(project, personId, spouseId);
}

export function removeSpouse(project, personId, spouseId) {
  return removePartners(project, personId, spouseId);
}

/** Add a child to a person: the person becomes the father or the mother (by sex; a person of unknown sex is set as the father), keeping the child's other parent. */
export function addChild(project, parentId, childId) {
  const parent = byIdOf(project)[parentId];
  if (!parent) throw new Error(`No person ${parentId}`);
  return setParent(project, childId, parent.sex === "F" ? "mother" : "father", parentId);
}

/** The people a person's family panel shows. */
export function familyOf(project, personId) {
  const byId = byIdOf(project);
  const p = byId[personId];
  if (!p) return null;
  return {
    person: p,
    father: byId[p.fatherId] ?? null,
    mother: byId[p.motherId] ?? null,
    spouses: (p.spouseIds ?? []).map((id) => byId[id]).filter(Boolean),
    children: (project.people ?? []).filter((c) => c.fatherId === personId || c.motherId === personId),
  };
}
