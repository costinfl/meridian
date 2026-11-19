// Matching runs (P9.T3) from the page: the heavy part (profiles, blocking, comparison) runs in a Web Worker when the
// browser has workers, else in the page; the run is recorded as a ProcessingRun ("entity-resolution") and its
// results are put on the project as candidate links and groups (src/conclusions/matching.js). Automated code: it
// never accepts or rejects anything (architecture rule I6).
import { findMatches } from "../resolve/run.js";
import { currentLinks } from "../conclusions/personaLinks.js";
import { applyMatches, matchingState } from "../conclusions/matching.js";
import { displayName } from "../models/project.js";

/** The project data the matcher needs, as plain data (names already resolved: functions do not cross to a worker). */
export function matchInputs(project, { full = false } = {}) {
  const state = matchingState(project);
  return {
    people: (project.people ?? []).map((p) => ({ ...p, name: displayName(p) || p.name || "" })),
    families: project.families ?? [], links: currentLinks(project),
    previous: state?.mark ? { mark: state.mark, prints: state.prints ?? {} } : null, full,
    dismissedPairs: project.matchDismissed ?? [],
    ...(state?.weights ? { weights: state.weights } : {}), ...(state?.threshold ? { threshold: state.threshold } : {}),
  };
}

export function createResolveClient({ library, useWorker = typeof Worker !== "undefined" && typeof window !== "undefined" && !import.meta.env?.VITEST } = {}) {
  const inPage = async (args) => findMatches({ ...args, snapshot: await library.searchIndex.snapshot() });
  if (!useWorker) return { find: inPage, close() {} };
  let worker = null, failed = false, seq = 0;
  const waiting = new Map();
  const fallBack = () => {
    if (failed) return;
    failed = true;
    try { worker?.terminate(); } catch { /* gone */ }
    for (const [id, w] of waiting) { waiting.delete(id); inPage(w.args).then(w.resolve, w.reject); }
  };
  try {
    worker = new Worker(new URL("./resolve.worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (e) => {
      const { id, ok, result, error } = e.data ?? {};
      const w = waiting.get(id);
      if (!w) return;
      waiting.delete(id);
      ok ? w.resolve(result) : w.reject(new Error(error));
    };
    worker.onerror = (e) => { e?.preventDefault?.(); fallBack(); };
  } catch { fallBack(); }
  return {
    find: (args) => (failed ? inPage(args) : new Promise((resolve, reject) => { const id = ++seq; waiting.set(id, { resolve, reject, args }); worker.postMessage({ id, args }); })),
    close: () => { try { worker?.terminate(); } catch { /* ignore */ } },
  };
}

/**
 * One matching run: record it, compute, put the results on the project. Returns { project, run, result, added, groups }.
 * The project passed to `apply` is the latest one (the caller's updater), so decisions made meanwhile are kept.
 */
export async function runMatching({ library, project, client, full = false }) {
  const inputs = matchInputs(project, { full });
  const run = await library.runs.startRun({ processor: "entity-resolution", processorVersion: "1", parameters: { scope: inputs.previous && !full ? "changed" : "all", weights: inputs.weights ?? null, threshold: inputs.threshold ?? null } });
  try {
    const result = await (client ?? createResolveClient({ library, useWorker: false })).find(inputs);
    await library.runs.finishRun(run.id, "succeeded");
    return { run, result, apply: (latest) => applyMatches(latest, result, run) };
  } catch (e) {
    await library.runs.finishRun(run.id, "failed").catch(() => {});
    throw e;
  }
}
