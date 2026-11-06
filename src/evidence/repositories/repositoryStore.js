import { newId, nowIso } from "../ids.js";
import { invalid, notFound, pick, requireOneOf, requireString } from "../domain/errors.js";

export const REPOSITORY_KINDS = ["archive", "library", "online", "private"];
const STORE = "evRepositories";
const EDITABLE = ["name", "kind", "location", "url"];

/** Where an original or copy is held or accessed (archive branch, library, online database such as Arcanum). */
export function createRepositoryStore(storage) {
  return {
    async create({ name, kind = "archive", location = "", url = "" } = {}) {
      const rec = {
        id: newId(),
        name: requireString(name, "name"),
        kind: requireOneOf(kind, REPOSITORY_KINDS, "kind"),
        location, url,
        createdAt: nowIso(),
      };
      rec.updatedAt = rec.createdAt;
      await storage.dbAdd(STORE, rec);
      return rec;
    },
    get: (id) => storage.dbGet(STORE, id).then((r) => r ?? null),
    async list() {
      return (await storage.dbGetAll(STORE)).sort((a, b) => a.name.localeCompare(b.name));
    },
    async findByName(name) {
      const n = String(name ?? "").trim().toLowerCase();
      return (await storage.dbGetAll(STORE)).find((r) => r.name.toLowerCase() === n) ?? null;
    },
    /** Descriptive metadata of a holding may be corrected; identity and createdAt may not. */
    async update(id, patch) {
      const cur = await storage.dbGet(STORE, id);
      if (!cur) throw notFound("Repository", id);
      const next = { ...cur, ...pick(patch, EDITABLE), updatedAt: nowIso() };
      requireString(next.name, "name");
      requireOneOf(next.kind, REPOSITORY_KINDS, "kind");
      if (typeof next.url !== "string") throw invalid("url must be a string");
      await storage.dbPut(STORE, next);
      return next;
    },
  };
}
