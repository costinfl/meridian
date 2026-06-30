export function createProject(name, { people = [], annotations = [], sources = [], settings = {} } = {}) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name,
    description: "",
    createdAt: now,
    updatedAt: now,
    people,
    annotations,
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
    citation: "",
    url: null,
    text: null,
    blobKey: null,
    fileName: null,
    mimeType: null,
    linkedPersonIds: [],
    linkedYearRange: null,
    tags: [],
    createdAt: new Date().toISOString(),
    ...rest,
  };
}
