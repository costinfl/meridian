// Version 1: the original schema. Never edit an applied step; add a new file instead.
export const v1 = {
  version: 1,
  up(db) {
    if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects", { keyPath: "id" });
    if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs", { keyPath: "key" });
  },
};
