import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { IndexedDBAdapter } from "../storage/adapters/IndexedDBAdapter.js";

/** A fresh in-memory IndexedDB + adapter. Call in beforeEach. */
export function freshStorage() {
  global.indexedDB = new IDBFactory();
  global.IDBKeyRange = IDBKeyRange; // repositories build index ranges with the global, as browsers provide
  return new IndexedDBAdapter();
}
