// Version 6 (Phase 7): `evSearchIndex`, the serialised search index. Derived data only: it can always be
// rebuilt from the other stores (I7), so losing it never loses evidence. One row per index (id "main").
export const v6 = {
  version: 6,
  up(db) {
    db.createObjectStore("evSearchIndex", { keyPath: "id" });
  },
};
