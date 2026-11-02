// Feature flag for the unfinished evidence UI (hidden until the reviewer turns it on).
// On when the project setting `evidenceUi` is true, or the URL has ?evidence=1 (for testing).
export function isEvidenceEnabled(project, search = typeof window !== "undefined" ? window.location.search : "") {
  if (project?.settings?.evidenceUi === true) return true;
  try {
    return new URLSearchParams(search).get("evidence") === "1";
  } catch {
    return false;
  }
}
