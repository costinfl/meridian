import { IDBFactory } from "fake-indexeddb";
import { IndexedDBAdapter } from "../storage/adapters/IndexedDBAdapter.js";

/** A fresh in-memory IndexedDB + adapter. Call in beforeEach. */
export function freshStorage() {
  global.indexedDB = new IDBFactory();
  return new IndexedDBAdapter();
}
