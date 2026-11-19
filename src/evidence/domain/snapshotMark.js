// What a derived structure (search index, graph) has seen of a library snapshot, exactly: the latest timestamp
// in it (`mark`) and the keys of the rows that carry exactly that timestamp (`atMark`). A row is new if its time
// is later than the mark, or equal to it but not one of those rows. (Milliseconds repeat, so a time alone is not
// enough.) Shared by the search index (Phase 7) and the graph projection (Phase 8).

export const STAMPED = [
  ["sources", (x) => x.updatedAt ?? x.createdAt], ["copies", (x) => x.updatedAt ?? x.createdAt], ["regions", (x) => x.createdAt],
  ["textLayers", (x) => x.createdAt], ["records", (x) => x.createdAt], ["personas", (x) => x.createdAt],
  ["assertions", (x) => x.createdAt], ["decisions", (x) => x.decidedAt], ["nameVariants", (x) => x.createdAt],
];
const STAMP_OF = Object.fromEntries(STAMPED);

export function markOf(snapshot) {
  let mark = "";
  for (const [k, t] of STAMPED) for (const x of snapshot[k] ?? []) { const ts = t(x) ?? ""; if (ts > mark) mark = ts; }
  const atMark = [];
  for (const [k, t] of STAMPED) for (const x of snapshot[k] ?? []) if ((t(x) ?? "") === mark && mark) atMark.push(`${k}:${x.id}`);
  return { mark, atMark: atMark.sort() };
}

/** A predicate factory: newerThan(seen)(kind)(row) is true when `row` of store `kind` was not seen. */
export function newerThan(seen) {
  const s = { mark: seen?.mark ?? "", atMarkSet: new Set(seen?.atMark ?? []) };
  return (kind) => (row) => {
    const ts = STAMP_OF[kind](row);
    return !!ts && (ts > s.mark || (ts === s.mark && !s.atMarkSet.has(`${kind}:${row.id}`)));
  };
}
