import JSZip from "jszip";
import { createProject, normalizeProject } from "./models/project.js";

/* ============================================================
   Native Meridian share bundle (.zip):
     · project.json  — the full project (people, annotations, eras, settings,
       and every source's metadata incl. its APA7 citation). This is the
       source of truth: metadata/citations survive even if a media file is
       later deleted from the zip by hand.
     · media/<blobKey>-<fileName> — the binary attachments (scanned PDFs,
       photos). These are optional; a researcher may strip large scans and
       the citation still rides along in project.json.
     · evidence.json — (bundle v2) the shared-library entities the project
       references: sources, copies, pages, regions, text layers, records,
       personas, assertions + their decisions, places, name variants, runs.
       Only written when the project references evidence, so projects without
       evidence export exactly as before and old bundles import unchanged.
       Never contains settings, API keys or folder handles.
   ============================================================ */

const MEDIA_DIR = "media/";
const safeName = (s) => String(s || "file").replace(/[^a-zA-Z0-9._-]/g, "_");

const hasLibrary = (storage) => typeof storage?.dbTransact === "function";

export async function exportProjectZip(project, storage) {
  const zip = new JSZip();
  const normalized = normalizeProject(project);
  zip.file("project.json", JSON.stringify(normalized, null, 2));

  const media = zip.folder("media");
  const added = new Set();
  const addMedia = async (blobKey, fileName) => {
    if (!blobKey || added.has(blobKey)) return;
    try {
      const blob = await storage.loadBlob(blobKey);
      if (blob) { media.file(`${blobKey}-${safeName(fileName)}`, blob); added.add(blobKey); }
    } catch {
      /* missing blob — metadata still travels in project.json */
    }
  };
  for (const s of normalized.sources ?? []) if (!s.fileMissing) await addMedia(s.blobKey, s.fileName);

  // bundle v2: the evidence the project references (code is loaded only when there is some)
  if (hasLibrary(storage)) {
    const { evidenceSeedsOf, projectReferencesEvidence } = await import("./conclusions/evidenceSeeds.js");
    if (projectReferencesEvidence(normalized)) {
      const { createEvidenceLibrary } = await import("./evidence/index.js");
      const data = await createEvidenceLibrary(storage).bundle.collect(evidenceSeedsOf(normalized));
      zip.file("evidence.json", JSON.stringify(data, null, 2));
      for (const c of data.copies) if (c.storage?.mode === "blob") await addMedia(c.storage.blobKey, c.fileName);
    }
  }
  return zip.generateAsync({ type: "blob" });
}

/** Import a bundle. Returns { project, evidence } where `evidence` summarises what was merged into the library (or null). */
export async function importProjectBundle(file, storage) {
  const zip = await JSZip.loadAsync(file);
  const jsonEntry = zip.file("project.json");
  if (!jsonEntry) throw new Error("Not a Meridian bundle: project.json missing");
  const raw = JSON.parse(await jsonEntry.async("string"));

  // fresh identity so importing never clobbers an existing project
  const base = createProject(raw.name ? `${raw.name} (imported)` : "Imported project");
  // A bundle from before families existed has no `families`: leave it unset so normalizeProject builds them from
  // fatherId/motherId/spouseIds (an empty default here would be read as "no relations" and wipe them).
  if (!Array.isArray(raw.families)) delete base.families;
  const project = normalizeProject({
    ...base,
    ...raw,
    id: crypto.randomUUID(),
    name: raw.name ? `${raw.name} (imported)` : "Imported project",
  });

  const readMedia = async (blobKey) => {
    const entry = zip.file(new RegExp(`^${MEDIA_DIR}${blobKey}(-|$)`));
    return entry && entry[0] ? entry[0].async("arraybuffer") : null;
  };

  for (const s of project.sources ?? []) {
    if (!s.blobKey) continue;
    const buf = await readMedia(s.blobKey);
    if (buf) {
      await storage.saveBlob(s.blobKey, new Blob([buf], { type: s.mimeType || "" }));
      s.fileMissing = false;
    } else {
      // the file was stripped from the bundle — keep the citation, drop the ref
      s.fileMissing = true;
      s.blobKey = null;
    }
  }

  // bundle v2: merge the evidence into the shared library, never overwriting
  let evidence = null;
  const evEntry = zip.file("evidence.json");
  if (evEntry && hasLibrary(storage)) {
    const data = JSON.parse(await evEntry.async("string"));
    const { createEvidenceLibrary } = await import("./evidence/index.js");
    evidence = await createEvidenceLibrary(storage).bundle.merge(data);
    // files of copies stored as blobs travel in media/ too
    for (const c of data.copies ?? []) {
      if (c.storage?.mode !== "blob" || !c.storage.blobKey) continue;
      if (await storage.loadBlob(c.storage.blobKey)) continue;
      const buf = await readMedia(c.storage.blobKey);
      if (buf) await storage.saveBlob(c.storage.blobKey, new Blob([buf], { type: c.mimeType || "" }));
    }
    // the project may point at a copy/page/region that was matched to an existing one by content hash
    const L = project.legacyEvidence;
    if (L) {
      project.legacyEvidence = {
        ...L,
        copyId: evidence.maps.copy[L.copyId] ?? L.copyId,
        regionId: evidence.maps.region[L.regionId] ?? L.regionId,
      };
    }
  } else if (evEntry) {
    evidence = { skipped: true, reason: "no evidence library available in this storage" };
  }
  return { project, evidence };
}

export async function importProjectZip(file, storage) {
  return (await importProjectBundle(file, storage)).project;
}
