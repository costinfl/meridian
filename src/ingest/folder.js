// Linking a documents folder (File System Access API, Chromium). The folder handle is kept in the device-local
// `settings` store only: it is never part of a project, a bundle or any export (invariant I9).

export const FOLDER_SETTING = "documentFolderHandle";

export const isFolderAccessSupported = (w = globalThis) => typeof w?.showDirectoryPicker === "function";

/** USER GESTURE required. Opens the picker and remembers the chosen folder. */
export async function linkFolder({ storage, picker = (opts) => globalThis.showDirectoryPicker(opts) }) {
  const handle = await picker({ mode: "read" });
  await storage.putSetting(FOLDER_SETTING, { handle, name: handle.name, linkedAt: new Date().toISOString() });
  return handle;
}

/** { handle, name, linkedAt } or null. */
export async function getLinkedFolder(storage) {
  return (await storage.getSetting(FOLDER_SETTING)) ?? null;
}

export const unlinkFolder = (storage) => storage.deleteSetting(FOLDER_SETTING);

/**
 * "granted" | "prompt" | "denied". Browsers forget the grant between sessions: call with request: true from a
 * click to ask again.
 */
export async function folderPermission(handle, { request = false } = {}) {
  if (!handle) return "denied";
  const opts = { mode: "read" };
  try {
    let state = typeof handle.queryPermission === "function" ? await handle.queryPermission(opts) : "granted";
    if (state !== "granted" && request && typeof handle.requestPermission === "function") state = await handle.requestPermission(opts);
    return state;
  } catch {
    return "denied";
  }
}

/** Every file below `dir`, depth first: { path, name, getFile() }. Hidden files and folders (dot-names) are skipped. */
export async function* walkFolder(dir, prefix = "") {
  const entries = [];
  for await (const [name, handle] of dir.entries()) entries.push([name, handle]);
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  for (const [name, handle] of entries) {
    if (name.startsWith(".")) continue;
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory") yield* walkFolder(handle, path);
    else yield { path, name, getFile: () => handle.getFile() };
  }
}

/** Read one file of the linked folder by its relative path. */
export async function readFolderFile(dir, path) {
  const parts = String(path).split("/").filter(Boolean);
  let cur = dir;
  for (const part of parts.slice(0, -1)) cur = await cur.getDirectoryHandle(part);
  return (await cur.getFileHandle(parts[parts.length - 1])).getFile();
}
