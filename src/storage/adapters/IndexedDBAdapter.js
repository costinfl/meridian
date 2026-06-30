const DB_NAME = "meridian-v1";
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("projects")) {
        db.createObjectStore("projects", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("blobs")) {
        db.createObjectStore("blobs", { keyPath: "key" });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function req(idbRequest) {
  return new Promise((resolve, reject) => {
    idbRequest.onsuccess = (e) => resolve(e.target.result);
    idbRequest.onerror = (e) => reject(e.target.error);
  });
}

export class IndexedDBAdapter {
  constructor() {
    this._db = null;
  }

  async _open() {
    if (!this._db) this._db = await openDB();
    return this._db;
  }

  async listProjects() {
    const db = await this._open();
    const all = await req(db.transaction("projects", "readonly").objectStore("projects").getAll());
    return all
      .map(({ id, name, updatedAt, people }) => ({
        id, name, updatedAt,
        personCount: people?.length ?? 0,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async loadProject(id) {
    const db = await this._open();
    return req(db.transaction("projects", "readonly").objectStore("projects").get(id));
  }

  async saveProject(project) {
    const db = await this._open();
    await req(db.transaction("projects", "readwrite").objectStore("projects").put(project));
  }

  async deleteProject(id) {
    const db = await this._open();
    await req(db.transaction("projects", "readwrite").objectStore("projects").delete(id));
  }

  async saveBlob(key, blob) {
    const db = await this._open();
    await req(db.transaction("blobs", "readwrite").objectStore("blobs").put({
      key,
      blob,
      mimeType: blob.type,
      fileName: blob.name ?? key,
    }));
    return key;
  }

  async loadBlob(key) {
    const db = await this._open();
    const record = await req(db.transaction("blobs", "readonly").objectStore("blobs").get(key));
    return record?.blob ?? null;
  }

  async deleteBlob(key) {
    const db = await this._open();
    await req(db.transaction("blobs", "readwrite").objectStore("blobs").delete(key));
  }
}
