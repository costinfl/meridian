/*
 * What a project references in the shared evidence library: the seeds for `bundle.collect`.
 * Pure: reads ids off the project document.
 */
export function evidenceSeedsOf(project) {
  const sourceIds = new Set(), copyIds = new Set(), personaIds = new Set(), assertionIds = new Set();
  for (const s of project.sources ?? []) if (s.librarySourceId) sourceIds.add(s.librarySourceId);
  const legacy = project.legacyEvidence;
  if (legacy?.librarySourceId) sourceIds.add(legacy.librarySourceId);
  if (legacy?.copyId) copyIds.add(legacy.copyId);
  for (const l of project.personaLinks ?? []) if (l.personaId) personaIds.add(l.personaId);
  for (const e of project.conclusionEvidence ?? []) if (e.assertionId) assertionIds.add(e.assertionId);
  for (const p of project.people ?? []) {
    for (const f of [p.birth, p.death, ...(p.events ?? []), ...(p.periods ?? []), ...(p.groups ?? [])]) {
      if (!f || typeof f !== "object") continue;
      for (const id of f.assertionIds ?? []) assertionIds.add(id);
      if (f.preferredAssertionId) assertionIds.add(f.preferredAssertionId);
    }
  }
  return { sourceIds: [...sourceIds], copyIds: [...copyIds], personaIds: [...personaIds], assertionIds: [...assertionIds] };
}

export function projectReferencesEvidence(project) {
  const s = evidenceSeedsOf(project);
  return s.sourceIds.length + s.copyIds.length + s.personaIds.length + s.assertionIds.length > 0;
}
