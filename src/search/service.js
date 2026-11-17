import { loadIndex, rebuildIndex, updateIndex } from "./indexer.js";
import { runQuery } from "./query.js";

// One search service per library: keeps the index in memory, loads it from the store, rebuilds it when missing.
// Used inside the search worker (src/workers/search.worker.js) or, without workers, directly in the page.
export function createSearchService(library, { now = () => Date.now() } = {}) {
  let state = null;   // { index, docCount, builtAt }
  return {
    /** The index, from memory, the store, or a rebuild. Returns { docCount, builtAt, rebuilt, ms }. */
    async ensure() {
      const t = now();
      let rebuilt = false;
      if (!state) state = await loadIndex(library);
      if (!state) { state = await rebuildIndex(library); rebuilt = true; }
      return { docCount: state.index.documentCount, builtAt: state.builtAt, rebuilt, ms: now() - t };
    },
    async rebuild() {
      const t = now();
      state = await rebuildIndex(library);
      return { docCount: state.index.documentCount, builtAt: state.builtAt, rebuilt: true, ms: now() - t };
    },
    /** Load or build, then apply changes made since the index was built. Returns { docCount, builtAt, changed, full, ms }. */
    async update() {
      const t = now();
      if (!state) state = await loadIndex(library);
      const r = await updateIndex(library, state);
      state = r.state;
      return { docCount: state.index.documentCount, builtAt: state.builtAt, changed: r.changed, full: r.full, ms: now() - t };
    },
    /**
     * Search. args = { q, fromYear, toYear, place (text), sourceKinds, sourceIds (scope, null = whole library),
     * confirmedOnly, limit }. A place name is resolved to the places with that name and every place below them.
     */
    async query({ q, place = "", limit = 50, ...filters } = {}) {
      if (!state) await this.ensure();
      let placeIds = null;
      if (String(place).trim()) {
        // documents list their place AND its ancestors, so matching the named place also finds places below it
        placeIds = new Set((await library.places.findByName(place)).map((p) => p.id));
        if (!placeIds.size) return { hits: [], placeNotFound: true };
      }
      const t = now();
      const hits = runQuery(state.index, q, { filters: { ...filters, placeIds }, nameVariants: await library.nameVariants.list(), limit });
      return { hits, ms: now() - t };
    },
    /** The in-memory index (after ensure). */
    current: () => state,
    _set: (s) => { state = s; },
  };
}

/** Operations understood by the service (shared by the worker and the in-page fallback). */
export async function runOp(service, op, args = {}) {
  if (op === "ensure") return service.ensure();
  if (op === "rebuild") return service.rebuild();
  if (op === "update") return service.update ? service.update(args) : service.ensure();
  if (op === "query") return service.query(args);
  throw new Error(`unknown search operation: ${op}`);
}

