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

  /* ---- generic object-store access (evidence library) ----
     Named db* so the architecture test can restrict callers to src/evidence/repositories
     and src/storage (this is what keeps append-only evidence append-only, I1).
     `dbAdd` rejects an existing key; `dbPut` overwrites. Inside dbTransact only await the
     ops handed to the callback (anything else lets the transaction auto-commit). */
  dbTransact(storeNames, mode, fn) {
    return this._open().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(storeNames, mode);
      const ops = {
        get: (s, k) => req(tx.objectStore(s).get(k)),
        put: (s, v) => req(tx.objectStore(s).put(v)),
        add: (s, v) => req(tx.objectStore(s).add(v)),
        delete: (s, k) => req(tx.objectStore(s).delete(k)), // only for disposable data (page cache)
        getAll: (s) => req(tx.objectStore(s).getAll()),
        getAllByIndex: (s, i, q) => req(tx.objectStore(s).index(i).getAll(q)),
        getByIndex: (s, i, q) => req(tx.objectStore(s).index(i).get(q)),
        count: (s) => req(tx.objectStore(s).count()),
      };
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
      Promise.resolve().then(() => fn(ops)).then(
        (r) => { result = r; },
        (err) => { reject(err); try { tx.abort(); } catch { /* already finished */ } },
      );
    }));
  }
  dbGet(store, key) { return this.dbTransact([store], "readonly", (o) => o.get(store, key)); }
  dbPut(store, value) { return this.dbTransact([store], "readwrite", (o) => o.put(store, value)); }
  dbAdd(store, value) { return this.dbTransact([store], "readwrite", (o) => o.add(store, value)); }
  dbGetAll(store) { return this.dbTransact([store], "readonly", (o) => o.getAll(store)); }
  dbGetAllByIndex(store, index, query) { return this.dbTransact([store], "readonly", (o) => o.getAllByIndex(store, index, query)); }
  dbGetByIndex(store, index, query) { return this.dbTransact([store], "readonly", (o) => o.getByIndex(store, index, query)); }
  dbCount(store) { return this.dbTransact([store], "readonly", (o) => o.count(store)); }

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
