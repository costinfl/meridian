// Browser storage durability helpers (best effort; degrade silently where unsupported).

const api = () => (typeof navigator !== "undefined" ? navigator.storage : undefined);

/** Ask the browser to keep our data when storage is under pressure. Resolves to true/false/null (unsupported). */
export async function requestPersistence() {
  const s = api();
  if (!s || typeof s.persist !== "function") return null;
  try {
    if (typeof s.persisted === "function" && (await s.persisted())) return true;
    return !!(await s.persist());
  } catch {
    return null;
  }
}

/** { persisted: boolean|null, usage: number|null, quota: number|null } in bytes; nulls when unknown. */
export async function getStorageStatus() {
  const s = api();
  const status = { persisted: null, usage: null, quota: null };
  if (!s) return status;
  try { if (typeof s.persisted === "function") status.persisted = !!(await s.persisted()); } catch { /* ignore */ }
  try {
    if (typeof s.estimate === "function") {
      const e = await s.estimate();
      status.usage = typeof e.usage === "number" ? e.usage : null;
      status.quota = typeof e.quota === "number" ? e.quota : null;
    }
  } catch { /* ignore */ }
  return status;
}

export function formatBytes(n) {
  if (n == null) return "unknown";
  const units = ["B", "kB", "MB", "GB", "TB"];
  let i = 0, v = n;
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** One-line description for the Evidence panel. */
export function describeStorage(status, lastExportIso) {
  const persist = status.persisted === null ? "Persistent storage: not supported by this browser"
    : status.persisted ? "Persistent storage: granted"
    : "Persistent storage: not granted — export a bundle regularly";
  const usage = status.usage == null ? "" : ` · Using ${formatBytes(status.usage)}${status.quota != null ? ` of ${formatBytes(status.quota)}` : ""}`;
  let last = " · Last bundle export: never";
  if (lastExportIso) {
    const d = new Date(lastExportIso);
    last = Number.isNaN(d.getTime()) ? " · Last bundle export: unknown" : ` · Last bundle export: ${d.toLocaleString()}`;
  }
  return persist + usage + last;
}
