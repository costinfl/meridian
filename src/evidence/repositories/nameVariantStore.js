import { newId, nowIso } from "../ids.js";
import { invalid, requireOneOf, requireString } from "../domain/errors.js";
import { searchKey } from "../domain/normalize.js";

export const VARIANT_ORIGINS = ["manual", "learned"];
const STORE = "evNameVariants";

/**
 * Spellings and language forms of given names and surnames that a person has paired (Ioan - Ion, Ioan - Iohannes).
 * A pair is a statement about spelling, not about identity, and pairs are not chained.
 */
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
     * Search expansion: the folded spellings that were explicitly paired with `name` (either direction),
     * plus its own key. ONE HOP ONLY: if Ioan~Ion and Ioan~Iohannes were entered, searching "Ion" finds
     * "Ioan" but NOT "Iohannes". Nothing is inferred transitively, and these pairs never decide that two
     * people are the same (that is a PersonaLink decision by a person).
     */
    async expand(name) {
      const key = searchKey(name);
      const seen = new Set([key]);
      for (const r of await storage.dbGetAllByIndex(STORE, "byCanonicalKey", key)) seen.add(r.variantKey);
      for (const r of await storage.dbGetAllByIndex(STORE, "byVariantKey", key)) seen.add(r.canonicalKey);
      return [...seen].sort();
    },
  };
}
