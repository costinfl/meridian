/*
 * Display names (P4.T7). A person is shown under the FIRST name identified for them: the name of the earliest
 * accepted persona link. The researcher may choose "Display person with this name instead" for any other linked
 * persona's name, for example the Hungarian spelling found in pre-1918 archives instead of the Romanian one
 * from after 1918. Display only: nothing is merged, renamed or re-linked, `person.name` (the canonical name,
 * used by GEDCOM) is untouched, and the choice is stored on the person as `displayNameChoice`.
 * Pure functions on the project; `nameOfPersona` is a Map or function persona id -> name (see personaNameMap).
 */
import { acceptedLinksInOrder } from "./personaLinks.js";

const lookup = (nameOfPersona) => (id) => (typeof nameOfPersona === "function" ? nameOfPersona(id) : nameOfPersona?.get?.(id)) ?? "";
const personOf = (project, personId) => (project.people ?? []).find((p) => p.id === personId);

/** The default: the name of the earliest accepted persona that has a known name; the person's own name as a last resort. */
export function defaultDisplayName(project, personId, nameOfPersona) {
  const nameOf = lookup(nameOfPersona);
  for (const link of acceptedLinksInOrder(project, personId)) {
    const name = nameOf(link.personaId);
    if (name) return name;
  }
  return personOf(project, personId)?.name ?? "";
}

/** Names the researcher can choose between: one per accepted persona link, earliest first. */
export function displayChoices(project, personId, nameOfPersona) {
  const nameOf = lookup(nameOfPersona);
  const person = personOf(project, personId);
  const chosen = person?.displayNameChoice?.personaId ?? null;
  const links = acceptedLinksInOrder(project, personId).filter((l) => nameOf(l.personaId));
  return links.map((l, i) => ({ personaId: l.personaId, name: nameOf(l.personaId), linkedAt: l.decidedAt, isDefault: i === 0, isChosen: l.personaId === chosen }));
}

/** The name to show now: the chosen one if its link is still accepted, otherwise the default. */
export function resolveDisplayName(project, personId, nameOfPersona) {
  const person = personOf(project, personId);
  const choice = person?.displayNameChoice;
  if (choice && acceptedLinksInOrder(project, personId).some((l) => l.personaId === choice.personaId)) return choice.name;
  return defaultDisplayName(project, personId, nameOfPersona);
}

/** USER ACTION: show this person under the name of one of their linked personas. */
export function chooseDisplayName(project, personId, personaId, nameOfPersona) {
  const person = personOf(project, personId);
  if (!person) throw new Error(`Unknown person: ${personId}`);
  if (!acceptedLinksInOrder(project, personId).some((l) => l.personaId === personaId)) throw new Error("That persona is not accepted as this person, so its name cannot be used for display");
  const name = lookup(nameOfPersona)(personaId);
  if (!name) throw new Error("That persona has no name to display");
  return { ...project, people: project.people.map((p) => (p.id === personId ? { ...p, displayNameChoice: { personaId, name, chosenAt: new Date().toISOString() } } : p)) };
}

/** USER ACTION: go back to the default (first identified) name. */
export function resetDisplayName(project, personId) {
  if (!personOf(project, personId)?.displayNameChoice) return project;
  return { ...project, people: project.people.map((p) => (p.id === personId ? { ...p, displayNameChoice: null } : p)) };
}

/** persona id -> name as it should be shown: the confirmed name fact if there is one, else the name as written. */
export async function personaNameMap(library, project, personId) {
  const map = new Map();
  for (const link of acceptedLinksInOrder(project, personId)) {
    const view = await library.personaView.forPersona(link.personaId).catch(() => null);
    const name = view?.facts?.name?.original || view?.asWritten?.nameAsWritten;
    if (name) map.set(link.personaId, name);
  }
  return map;
}
