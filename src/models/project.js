import { buildFamilies, derivePeopleFromFamilies } from "./families.js";

export function createProject(name, { people = [], annotations = [], eras = [], sources = [], settings = {} } = {}) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name,
    description: "",
    createdAt: now,
    updatedAt: now,
    people,
    annotations,
    eras,
    sources,
    // Layer 4 conclusions (evidence-model.md). Families are the source of truth for parents/spouses.
    families: buildFamilies(people),
    personaLinks: [],
    relationships: [],
    conclusionEvidence: [],
    proofNotes: [],
    legacyEvidence: null, // set when legacy facts were converted to evidence (conclusions/legacyFacts.js)
    settings: {
      focusPersonId: people[0]?.id ?? null,
      relativeIds: [],
      view: { left: 1842, ppy: 8 },
      ctxOn: { local: true, national: true, global: true },
      evidenceUi: false, // feature flag for the unfinished evidence layer UI
      ...settings,
    },
  };
}

export function createSource({ title = "Untitled source", type = "text", ...rest } = {}) {
  return {
    id: crypto.randomUUID(),
    title,
    type,
    date: "",
    repository: "",
    description: "",
    citation: "", // APA7-style reference — always retained in the native share JSON
    url: null,
    text: null,
    blobKey: null,
    fileName: null,
    mimeType: null,
    fileMissing: false, // true when the media file was removed from a shared bundle
    librarySourceId: null, // id of the evidence-library source this one is linked to (set when first used as evidence)
    linkedPersonIds: [],
    linkedYearRange: null,
    tags: [],
    verified: false,
    createdAt: new Date().toISOString(),
    ...rest,
  };
}

/* ---- timeline sub-item factories ----
   Every timeline item carries a stable `id` so it can be edited/deleted, plus
   optional `color`, `note`, and `sourceId` (a reference into project.sources). */

export function createEvent({ year, label = "", type = "note", note = "", color = null, sourceId = null, verified = false } = {}) {
  return { id: crypto.randomUUID(), year, label, type, note, color, sourceId, verified };
}

// Role / occupation bar (person.periods) — e.g. "Mayor of Ploiești".
export function createPeriod({ start, end, label = "", note = "", color = null, sourceId = null, verified = false } = {}) {
  return { id: crypto.randomUUID(), start, end, label, note, color, sourceId, verified };
}

// Event-group band (person.groups) — e.g. "Communist regime", "Săhăteni estate".
export function createGroup({ start, end, label = "", note = "", color = null, sourceId = null, verified = false } = {}) {
  return { id: crypto.randomUUID(), start, end, label, note, color, sourceId, verified };
}

// Accolade bracket (project.annotations) — spans a lane, not tied to a group/events.
export function createAnnotation({ laneKey, start, end, title = "", note = "", color = null, sourceId = null } = {}) {
  return { id: crypto.randomUUID(), laneKey, start, end, title, note, color, sourceId };
}

// Full-board era band (project.eras) — e.g. "Cold War", spans all lanes.
export function createEra({ start, end, label = "", color = null, note = "", sourceId = null } = {}) {
  return { id: crypto.randomUUID(), start, end, label, color, note, sourceId };
}

// Pinned media (person.media) — references an existing image/document source at a year.
export function createMediaPin({ year, sourceId = null, label = "", color = null } = {}) {
  return { id: crypto.randomUUID(), year, sourceId, label, color };
}

/* Ensure a loaded project has every array + stable ids on sub-items, so older
   projects (and GEDCOM imports) upgrade transparently. Returns the same object
   when nothing needed changing, otherwise a shallow-cloned, upgraded project.

   Conclusions (Phase 4): older projects gain empty conclusion arrays, every fact gains
   `assertionIds` / `preferredAssertionId`, and families become the source of truth for
   fatherId / motherId / spouseIds. Projects without `families` get them built from the legacy
   fields; afterwards the legacy fields are derived from families. */
const EVIDENCE_LISTS = ["personaLinks", "relationships", "conclusionEvidence", "proofNotes"];

export function normalizeProject(project) {
  if (!project) return project;
  const withId = (item) => (item && item.id ? item : { id: crypto.randomUUID(), ...item });
  const withEvidence = (item) => {
    if (!item || (Array.isArray(item.assertionIds) && "preferredAssertionId" in item)) return item;
    return { ...item, assertionIds: Array.isArray(item.assertionIds) ? item.assertionIds : [], preferredAssertionId: item.preferredAssertionId ?? null };
  };

  let peopleChanged = false;
  let people = (project.people ?? []).map((p) => {
    const events = (p.events ?? []).map(withId).map(withEvidence);
    const periods = (p.periods ?? []).map(withId).map(withEvidence);
    const groups = (p.groups ?? []).map(withId).map(withEvidence);
    const media = (p.media ?? []).map(withId);
    const birth = p.birth && typeof p.birth === "object" ? withEvidence(p.birth) : p.birth;
    const death = p.death && typeof p.death === "object" ? withEvidence(p.death) : p.death;
    const changed =
      !p.events || !p.periods || !p.groups || !p.media ||
      events.some((e, i) => e !== p.events?.[i]) ||
      periods.some((e, i) => e !== p.periods?.[i]) ||
      groups.some((e, i) => e !== p.groups?.[i]) ||
      media.some((e, i) => e !== p.media?.[i]) ||
      birth !== p.birth || death !== p.death;
    if (!changed) return p;
    peopleChanged = true;
    return { ...p, events, periods, groups, media, birth, death };
  });

  const annotations = (project.annotations ?? []).map(withId);
  const eras = (project.eras ?? []).map(withId);

  const needsEras = !project.eras;
  const annotationsChanged = annotations.some((a, i) => a !== project.annotations?.[i]);
  const erasChanged = needsEras || eras.some((e, i) => e !== project.eras?.[i]);

  // conclusions
  const missingLists = EVIDENCE_LISTS.filter((k) => !Array.isArray(project[k]));
  let families = project.families;
  let familiesChanged = false;
  if (!Array.isArray(families)) {
    families = buildFamilies(people);   // first upgrade: the legacy fields are the only record of who is related
    familiesChanged = true;
  } else {
    const derived = derivePeopleFromFamilies(people, families);
    if (derived !== people) { people = derived; peopleChanged = true; }
  }

  const legacyMissing = !("legacyEvidence" in project);
  if (!peopleChanged && !annotationsChanged && !erasChanged && !familiesChanged && !missingLists.length && !legacyMissing) return project;
  const next = { ...project, people, annotations, eras, families };
  for (const k of missingLists) next[k] = [];
  if (legacyMissing) next.legacyEvidence = null;
  return next;
}
