// The evidence layer is ON by default (reviewer decision, 2026-11-16). A project can switch it off
// (settings.evidenceOff === true, from the Projects dialog). The URL can force it for testing: ?evidence=1 / ?evidence=0.
// The older setting `evidenceUi` (on/off while the layer was a preview) is ignored.
export function isEvidenceEnabled(project, search = typeof window !== "undefined" ? window.location.search : "") {
  try {
    const q = new URLSearchParams(search).get("evidence");
    if (q === "1") return true;
    if (q === "0") return false;
  } catch { /* ignore a malformed query */ }
  return project?.settings?.evidenceOff !== true;
}
