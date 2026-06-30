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
}

export const storage = new StorageService();
