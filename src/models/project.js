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
    settings: {
      focusPersonId: people[0]?.id ?? null,
      relativeIds: [],
      view: { left: 1842, ppy: 8 },
      ctxOn: { local: true, national: true, global: true },
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
   when nothing needed changing, otherwise a shallow-cloned, upgraded project. */
export function normalizeProject(project) {
  if (!project) return project;
  const withId = (item) => (item && item.id ? item : { id: crypto.randomUUID(), ...item });

  let peopleChanged = false;
  const people = (project.people ?? []).map((p) => {
    const events = (p.events ?? []).map(withId);
    const periods = (p.periods ?? []).map(withId);
    const groups = (p.groups ?? []).map(withId);
    const media = (p.media ?? []).map(withId);
    const changed =
      !p.events || !p.periods || !p.groups || !p.media ||
      events.some((e, i) => e !== p.events?.[i]) ||
      periods.some((e, i) => e !== p.periods?.[i]) ||
      groups.some((e, i) => e !== p.groups?.[i]) ||
      media.some((e, i) => e !== p.media?.[i]);
    if (!changed) return p;
    peopleChanged = true;
    return { ...p, events, periods, groups, media };
  });

  const annotations = (project.annotations ?? []).map(withId);
  const eras = (project.eras ?? []).map(withId);

  const needsEras = !project.eras;
  const annotationsChanged = annotations.some((a, i) => a !== project.annotations?.[i]);
  const erasChanged = needsEras || eras.some((e, i) => e !== project.eras?.[i]);

  if (!peopleChanged && !annotationsChanged && !erasChanged) return project;
  return { ...project, people, annotations, eras };
}
