// Identifiers and timestamps for evidence records.
export const newId = () => crypto.randomUUID();

let last = 0;
/** ISO timestamp that is strictly increasing within this process, so "newest" is well defined. */
export function nowIso() {
  let t = Date.now();
  if (t <= last) t = last + 1;
  last = t;
  return new Date(t).toISOString();
}
