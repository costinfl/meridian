// Version 2: device-local settings (e.g. last bundle export time, later API keys).
// Never part of project documents or bundles (invariant I9).
export const v2 = {
  version: 2,
  up(db) {
    if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath: "key" });
  },
};
