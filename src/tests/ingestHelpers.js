import fs from "node:fs";
import path from "node:path";

export const FIXTURES = path.resolve(__dirname, "fixtures");
export const fixtureBytes = (name) => new Uint8Array(fs.readFileSync(path.join(FIXTURES, name)));

/** A File-like object (name, size, type, arrayBuffer, text) without relying on jsdom's Blob. */
export function fakeFile(name, content, type = "") {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  return { name, type, size: bytes.byteLength, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), text: async () => new TextDecoder().decode(bytes) };
}

/** In-memory stand-in for a FileSystemDirectoryHandle. `tree`: { "name": bytes|string | { ...subfolder } } */
export function fakeDirectory(tree, name = "Documents", perm = { state: "granted" }) {
  const isDir = (v) => v && typeof v === "object" && !(v instanceof Uint8Array);
  const fileHandle = (n, v) => ({ kind: "file", name: n, getFile: async () => fakeFile(n, v) });
  return {
    kind: "directory", name,
    async *entries() { for (const [n, v] of Object.entries(tree)) yield [n, isDir(v) ? fakeDirectory(v, n, perm) : fileHandle(n, v)]; },
    async getDirectoryHandle(n) { if (!isDir(tree[n])) throw new Error(`NotFoundError: ${n}`); return fakeDirectory(tree[n], n, perm); },
    async getFileHandle(n) { if (tree[n] === undefined || isDir(tree[n])) throw new Error(`NotFoundError: ${n}`); return fileHandle(n, tree[n]); },
    queryPermission: async () => perm.state,
    requestPermission: async () => { perm.requested = (perm.requested ?? 0) + 1; if (perm.grantOnRequest) perm.state = "granted"; return perm.state; },
  };
}

/** Settings + blobs in memory (fake-indexeddb cannot store handles with methods or real Blobs). */
export function memoryDeviceStorage(adapter) {
  const settings = new Map(), blobs = new Map();
  const s = {
    settings, blobs,
    getSetting: async (k) => settings.get(k), putSetting: async (k, v) => { settings.set(k, v); }, deleteSetting: async (k) => { settings.delete(k); },
    saveBlob: async (k, b) => { blobs.set(k, b); return k; }, loadBlob: async (k) => blobs.get(k) ?? null, deleteBlob: async (k) => { blobs.delete(k); },
  };
  for (const m of ["dbTransact", "dbGet", "dbPut", "dbAdd", "dbGetAll", "dbGetAllByIndex", "dbGetByIndex", "dbCount"]) s[m] = (...a) => adapter[m](...a);
  return s;
}
