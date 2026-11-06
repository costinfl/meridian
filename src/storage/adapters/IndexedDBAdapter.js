import { DB_VERSION, UPGRADES, runUpgrades } from "../upgrades/index.js";

const DB_NAME = "meridian-v1"; // name kept for compatibility; the schema version is separate

/** Open the database, applying forward-only upgrade steps. `onVersionChange` fires when another
    tab/session needs to upgrade; the connection is closed first so the upgrade is not blocked. */
export function openDB({ name = DB_NAME, version = DB_VERSION, steps = UPGRADES, onVersionChange, onBlocked } = {}) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = (e) => {
      runUpgrades(e.target.result, e.target.transaction, e.oldVersion, e.newVersion, steps);
    };
    request.onblocked = () => onBlocked?.();
    request.onsuccess = (e) => {
      const db = e.target.result;
      db.onversionchange = () => { db.close(); onVersionChange?.(); };
      resolve(db);
    };
    request.onerror = (e) => reject(e.target.error);
  });
}

function req(idbRequest) {
  return new Promise((resolve, reject) => {
    idbRequest.onsuccess = (e) => resolve(e.target.result);
    idbRequest.onerror = (e) => reject(e.target.error);
  });
}

export class IndexedDBAdapter {
  /** @param {{ onVersionChange?: () => void, onBlocked?: () => void }} [hooks] */
  constructor(hooks = {}) {
    this._db = null;
    this._hooks = hooks;
  }

  async _open() {
    if (!this._db) {
      this._db = await openDB({
        onVersionChange: () => { this._db = null; this._hooks.onVersionChange?.(); },
        onBlocked: () => this._hooks.onBlocked?.(),
      });
    }
    return this._db;
  }

  // Device-local key/value settings (never exported). `value` must be structured-cloneable.
  async getSetting(key) {
    const db = await this._open();
    const row = await req(db.transaction("settings", "readonly").objectStore("settings").get(key));
    return row ? row.value : undefined;
  }

  async putSetting(key, value) {
    const db = await this._open();
    await req(db.transaction("settings", "readwrite").objectStore("settings").put({ key, value }));
  }

  async deleteSetting(key) {
    const db = await this._open();
    await req(db.transaction("settings", "readwrite").objectStore("settings").delete(key));
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
