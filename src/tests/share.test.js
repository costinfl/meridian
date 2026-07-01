import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { exportProjectZip, importProjectZip } from "../share.js";
import { createProject, createSource, createEra, createAnnotation } from "../models/project.js";

/* Minimal in-memory stand-in for StorageService's blob API. */
function fakeStorage() {
  const blobs = new Map();
  return {
    blobs,
    async saveBlob(key, blob) { blobs.set(key, blob); },
    async loadBlob(key) { return blobs.get(key) ?? null; },
  };
}

/* A project exercising people, eras, annotations, and a source with an attached media blob. */
function seededProject(storage) {
  const src = createSource({
    title: "Birth certificate",
    type: "image",
    citation: "Registrul Stării Civile. (1850). Ploiești.",
    blobKey: "blob_1",
    fileName: "cert.png",
    mimeType: "image/png",
    verified: true,
  });
  storage.blobs.set("blob_1", new Blob(["fake-png-bytes"], { type: "image/png" }));

  return createProject("Popescu family", {
    people: [{ id: "i1", name: "Ion Popescu", sex: "M", birth: { year: 1850 }, death: { year: 1921 }, events: [], periods: [], groups: [], media: [] }],
    eras: [createEra({ start: 1947, end: 1989, label: "Communist regime" })],
    annotations: [createAnnotation({ laneKey: "p:i1", start: 1914, end: 1918, title: "WWI gap" })],
    sources: [src],
  });
}

describe("exportProjectZip / importProjectZip", () => {
  it("round-trips people, eras, annotations, and source metadata", async () => {
    const storage = fakeStorage();
    const project = seededProject(storage);

    const zipBlob = await exportProjectZip(project, storage);
    const dest = fakeStorage();
    const imported = await importProjectZip(zipBlob, dest);

    expect(imported.people[0].name).toBe("Ion Popescu");
    expect(imported.eras[0].label).toBe("Communist regime");
    expect(imported.annotations[0].title).toBe("WWI gap");

    const s = imported.sources[0];
    expect(s.title).toBe("Birth certificate");
    expect(s.citation).toBe("Registrul Stării Civile. (1850). Ploiești.");
  });

  it("gives the imported project a fresh id and an '(imported)' name", async () => {
    const storage = fakeStorage();
    const project = seededProject(storage);
    const imported = await importProjectZip(await exportProjectZip(project, storage), fakeStorage());

    expect(imported.id).not.toBe(project.id);
    expect(imported.name).toBe("Popescu family (imported)");
  });

  it("restores the media blob into the destination storage", async () => {
    const storage = fakeStorage();
    const project = seededProject(storage);

    const dest = fakeStorage();
    const imported = await importProjectZip(await exportProjectZip(project, storage), dest);

    const s = imported.sources[0];
    expect(s.blobKey).toBe("blob_1");
    expect(s.fileMissing).toBe(false);
    expect(dest.blobs.has("blob_1")).toBe(true);
  });

  it("keeps citation/metadata when the media file was stripped from the bundle", async () => {
    const storage = fakeStorage();
    const project = seededProject(storage);
    const zipBlob = await exportProjectZip(project, storage);

    // simulate a researcher hand-deleting the large scan from the zip
    const zip = await JSZip.loadAsync(zipBlob);
    Object.keys(zip.files).filter((n) => n.startsWith("media/") && !zip.files[n].dir).forEach((n) => zip.remove(n));
    const stripped = await zip.generateAsync({ type: "blob" });

    const dest = fakeStorage();
    const imported = await importProjectZip(stripped, dest);

    const s = imported.sources[0];
    expect(s.title).toBe("Birth certificate");
    expect(s.citation).toBe("Registrul Stării Civile. (1850). Ploiești.");
    expect(s.fileMissing).toBe(true);
    expect(s.blobKey).toBeNull();
    expect(dest.blobs.has("blob_1")).toBe(false);
  });

  it("rejects a zip that is not a Meridian bundle", async () => {
    const notABundle = await new JSZip().file("readme.txt", "hello").generateAsync({ type: "blob" });
    await expect(importProjectZip(notABundle, fakeStorage())).rejects.toThrow(/project\.json/);
  });
});
