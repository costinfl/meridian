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
   ============================================================ */

const MEDIA_DIR = "media/";
const safeName = (s) => String(s || "file").replace(/[^a-zA-Z0-9._-]/g, "_");

export async function exportProjectZip(project, storage) {
  const zip = new JSZip();
  const normalized = normalizeProject(project);
  zip.file("project.json", JSON.stringify(normalized, null, 2));

  const media = zip.folder("media");
  for (const s of normalized.sources ?? []) {
    if (!s.blobKey || s.fileMissing) continue;
    try {
      const blob = await storage.loadBlob(s.blobKey);
      if (blob) media.file(`${s.blobKey}-${safeName(s.fileName)}`, blob);
    } catch {
      /* missing blob — metadata still travels in project.json */
    }
  }
  return zip.generateAsync({ type: "blob" });
}

export async function importProjectZip(file, storage) {
  const zip = await JSZip.loadAsync(file);
  const jsonEntry = zip.file("project.json");
  if (!jsonEntry) throw new Error("Not a Meridian bundle: project.json missing");
  const raw = JSON.parse(await jsonEntry.async("string"));

  // fresh identity so importing never clobbers an existing project
  const project = normalizeProject({
    ...createProject(raw.name ? `${raw.name} (imported)` : "Imported project"),
    ...raw,
    id: crypto.randomUUID(),
    name: raw.name ? `${raw.name} (imported)` : "Imported project",
  });

  for (const s of project.sources ?? []) {
    if (!s.blobKey) continue;
    const entry = zip.file(new RegExp(`^${MEDIA_DIR}${s.blobKey}(-|$)`));
    const match = entry && entry[0];
    if (match) {
      const buf = await match.async("arraybuffer");
      await storage.saveBlob(s.blobKey, new Blob([buf], { type: s.mimeType || "" }));
      s.fileMissing = false;
    } else {
      // the file was stripped from the bundle — keep the citation, drop the ref
      s.fileMissing = true;
      s.blobKey = null;
    }
  }
  return project;
}
