// Link an existing project source (project.sources[], ADR-0002) to the shared evidence library.
// Pure with respect to the project: it returns what to store; the caller persists it.
// Not run automatically: later phases call it when a source is first used as evidence (Phase 4/5).

const KIND_BY_TYPE = { document: "archival-document", image: "image", url: "web" };
const ISO_PREFIX = /^\d{4}(-\d{2}(-\d{2})?)?$/;

/**
 * @param {object} args
 * @param {ReturnType<import("../evidence/index.js").createEvidenceLibrary>} args.library
 * @param {(blobKey: string) => Promise<Blob|null>} args.loadBlob   e.g. storage.loadBlob
 * @param {object} args.project
 * @param {string} args.sourceId   id of an entry in project.sources
 * @returns {Promise<{ project: object, patch: {librarySourceId: string}, librarySourceId: string,
 *   repositoryId: string|null, copyId: string|null, copyCreated: boolean, warnings: string[] }>}
 */
export async function linkProjectSourceToLibrary({ library, loadBlob, project, sourceId }) {
  const src = (project?.sources ?? []).find((s) => s.id === sourceId);
  if (!src) throw new Error(`Project source not found: ${sourceId}`);
  const warnings = [];
  const done = (librarySourceId, extra) => {
    const patch = { librarySourceId };
    const next = { ...project, sources: project.sources.map((s) => (s.id === sourceId ? { ...s, ...patch } : s)) };
    return { project: next, patch, librarySourceId, repositoryId: null, copyId: null, copyCreated: false, warnings, ...extra };
  };

  // Idempotent: already linked and still present in the library.
  if (src.librarySourceId) {
    const existing = await library.sources.get(src.librarySourceId);
    if (existing) {
      const copies = await library.copies.listBySource(existing.id);
      return done(existing.id, { repositoryId: existing.repositoryId, copyId: copies[0]?.id ?? null });
    }
    warnings.push("previous librarySourceId no longer exists in the library; linking again");
  }

  // Repository from the free-text field.
  let repositoryId = null;
  const repoName = (src.repository ?? "").trim();
  if (repoName) {
    const repo = (await library.repositories.findByName(repoName))
      ?? (await library.repositories.create({ name: repoName, kind: src.type === "url" ? "online" : "private" }));
    repositoryId = repo.id;
  }

  const dateText = (src.date ?? "").trim();
  const libSource = await library.sources.create({
    kind: KIND_BY_TYPE[src.type] ?? "other",
    title: src.title || "Untitled source",
    citation: src.citation ?? "",
    dateText,
    dateRange: ISO_PREFIX.test(dateText) ? { from: dateText, to: dateText } : null,
    url: src.url ?? "",
    repositoryId,
  });

  // The attached file, if any, becomes a DigitalCopy (identity = content hash).
  let copyId = null, copyCreated = false;
  if (src.blobKey && !src.fileMissing) {
    const blob = await loadBlob(src.blobKey);
    if (blob) {
      const { copy, created } = await library.copies.registerFile(blob, {
        sourceId: libSource.id,
        fileName: src.fileName ?? "",
        mimeType: src.mimeType ?? blob.type ?? "",
        storage: { mode: "blob", blobKey: src.blobKey },
        accessUrl: src.url ?? "",
      });
      copyId = copy.id; copyCreated = created;
      if (!created && copy.sourceId !== libSource.id) {
        if (!copy.sourceId) await library.copies.update(copy.id, { sourceId: libSource.id });
        else warnings.push("the same file is already registered under another library source");
      }
    } else {
      warnings.push(`attached file ${src.blobKey} was not found in storage; no copy registered`);
    }
  }
  if (src.type === "text" && src.text) warnings.push("text-only sources have no file; no copy registered");

  return done(libSource.id, { repositoryId, copyId, copyCreated });
}
