// Version 5 (review follow-ups to Phases 2-3):
//  - evRegions: `bySupersedes` index (a region's box can be corrected by a superseding region).
//  - evAssertionDecisions: confirm/reject decisions as their own append-only events (unique per assertion).
//  - one-time migration of decisions that an earlier build wrote onto the assertion row itself.
export const v5 = {
  version: 5,
  up(db, tx) {
    tx.objectStore("evRegions").createIndex("bySupersedes", "supersedesId", { unique: false });

    const decisions = db.createObjectStore("evAssertionDecisions", { keyPath: "id" });
    decisions.createIndex("byAssertion", "assertionId", { unique: true });
    decisions.createIndex("byStatus", "status", { unique: false });

    // Earlier build: a decision overwrote status/decidedBy/decidedAt on the assertion row.
    // A row entered directly by the user has decidedAt <= createdAt (decided at creation); a row decided
    // later has decidedAt > createdAt. Move the latter into an event and restore the row to "proposed".
    const rows = tx.objectStore("evAssertions");
    const cursorReq = rows.openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return;
      const a = cursor.value;
      if ((a.status === "confirmed" || a.status === "rejected") && a.decidedAt && a.decidedAt > a.createdAt) {
        decisions.add({ id: crypto.randomUUID(), assertionId: a.id, status: a.status, decidedBy: a.decidedBy, decidedAt: a.decidedAt });
        cursor.update({ ...a, status: "proposed", decidedBy: null, decidedAt: null });
      }
      cursor.continue();
    };
  },
};
