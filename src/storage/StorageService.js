import { IndexedDBAdapter } from "./adapters/IndexedDBAdapter.js";

class StorageService {
  constructor() {
    this._adapter = new IndexedDBAdapter();
  }

  setAdapter(adapter) {
    this._adapter = adapter;
  }

  listProjects() { return this._adapter.listProjects(); }
  loadProject(id) { return this._adapter.loadProject(id); }
  saveProject(project) { return this._adapter.saveProject(project); }
  deleteProject(id) { return this._adapter.deleteProject(id); }
  saveBlob(key, blob) { return this._adapter.saveBlob(key, blob); }
  loadBlob(key) { return this._adapter.loadBlob(key); }
  deleteBlob(key) { return this._adapter.deleteBlob(key); }
  // generic store access for the evidence library; call only from src/evidence/repositories (see architecture test)
  dbTransact(stores, mode, fn) { return this._adapter.dbTransact(stores, mode, fn); }
  dbGet(store, key) { return this._adapter.dbGet(store, key); }
  dbPut(store, value) { return this._adapter.dbPut(store, value); }
  dbAdd(store, value) { return this._adapter.dbAdd(store, value); }
  dbGetAll(store) { return this._adapter.dbGetAll(store); }
  dbGetAllByIndex(store, index, query) { return this._adapter.dbGetAllByIndex(store, index, query); }
  dbGetByIndex(store, index, query) { return this._adapter.dbGetByIndex(store, index, query); }
  dbCount(store) { return this._adapter.dbCount(store); }
  getSetting(key) { return this._adapter.getSetting(key); }
  putSetting(key, value) { return this._adapter.putSetting(key, value); }
  deleteSetting(key) { return this._adapter.deleteSetting(key); }
}

export const storage = new StorageService();
