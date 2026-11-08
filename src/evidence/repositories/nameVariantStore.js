import { newId, nowIso } from "../ids.js";
import { invalid, requireOneOf, requireString } from "../domain/errors.js";
import { searchKey } from "../domain/normalize.js";

export const VARIANT_ORIGINS = ["manual", "learned"];
const STORE = "evNameVariants";

/** Spellings and language forms of given names and surnames (Ioan = Iohannes = Jan = John...). */
export function createNameVariantStore(storage) {
  return {
    async add({ canonical, variant, language = "", origin = "manual" } = {}) {
      const rec = {
        id: newId(),
        canonical: requireString(canonical, "canonical"), canonicalKey: searchKey(canonical),
        variant: requireString(variant, "variant"), variantKey: searchKey(variant),
        language, origin: requireOneOf(origin, VARIANT_ORIGINS, "origin"), createdAt: nowIso(),
      };
      if (rec.canonicalKey === rec.variantKey) throw invalid("canonical and variant are the same name once folded");
      const dup = (await storage.dbGetAllByIndex(STORE, "byCanonicalKey", rec.canonicalKey)).find((r) => r.variantKey === rec.variantKey);
      if (dup) return dup; // already known: idempotent
      await storage.dbAdd(STORE, rec);
      return rec;
    },
    list: () => storage.dbGetAll(STORE),
    /**
     * All folded spellings known to mean the same name as `name` (including its own key): follows
     * canonical<->variant links in both directions, transitively.
     */
    async expand(name) {
      const start = searchKey(name);
      const seen = new Set([start]);
      const queue = [start];
      while (queue.length) {
        const key = queue.shift();
        const links = [
          ...(await storage.dbGetAllByIndex(STORE, "byCanonicalKey", key)).map((r) => r.variantKey),
          ...(await storage.dbGetAllByIndex(STORE, "byVariantKey", key)).map((r) => r.canonicalKey),
        ];
        for (const k of links) if (!seen.has(k)) { seen.add(k); queue.push(k); }
      }
      return [...seen].sort();
    },
  };
}
