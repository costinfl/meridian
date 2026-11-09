/*
 * Legacy timeline facts as evidence (Phase 4).
 *
 * Every existing fact (birth, death, event, period, group) becomes ONE import-agent assertion on an
 * import-agent persona of its person, cited to the fact's own source (when the fact has one) or to the
 * "Legacy Meridian data" source. All assertions start `proposed`; a separate, deliberate user step
 * (`confirmLegacyVerified`) confirms those whose fact was marked verified, with decidedBy "legacy-verified".
 * Facts keep working exactly as before; they just gain `assertionIds` / `preferredAssertionId`.
 *
 *   inventory / dryRun  pure, read-only: what would be converted (counts, anomalies, fields with no target)
 *   convertLegacyFacts  USER ACTION: writes the evidence and returns the updated project (caller saves it)
 *   confirmLegacyVerified  USER ACTION: confirms the assertions of verified facts
 *   setFactVerified     USER ACTION: keeps "verified <=> preferred assertion confirmed" when a fact is toggled
 *
 * Idempotent for completed runs: converted facts and persons are skipped, nothing is written (not even a run) when
 * there is nothing to convert, and every assertion carries a stable legacy key so it is never proposed twice for
 * the same persona. If a run fails midway nothing is saved to the project (the caller only persists a returned
 * project), so a retry starts from the unchanged project and creates fresh personas; the records already written
 * by the failed attempt stay in the shared library as unlinked legacy personas (harmless, but noise).
 */
import { linkProjectSourceToLibrary } from "./linkLegacySource.js";
import { addLink, decideLink, linksOfPerson } from "./personaLinks.js";

export const FACT_KINDS = ["birth", "death", "event", "period", "group"];
export const LEGACY_METHOD = "legacy-import";
export const LEGACY_VERIFIED_BY = "legacy-verified";
const PROPERTY = { birth: "x-legacy.birth", death: "x-legacy.death", event: "x-legacy.event", period: "x-legacy.period", group: "x-legacy.group" };
const text = (v) => (v == null ? "" : String(v));

/* ---------- facts of a person ---------- */

function factsOf(person) {
  const out = [];
  for (const kind of ["birth", "death"]) {
    const f = person[kind];
    if (f && typeof f === "object" && (f.year != null || text(f.place).trim())) out.push({ kind, fact: f, key: `${person.id}#${kind}` });
  }
  for (const [kind, list] of [["event", person.events], ["period", person.periods], ["group", person.groups]]) {
    for (const f of list ?? []) out.push({ kind, fact: f, key: `${person.id}#${kind}:${f.id ?? out.length}` });
  }
  return out;
}

function describeFact(kind, f) {
  const years = (a, b) => (a != null && b != null ? `${a}-${b}` : text(a ?? b));
  switch (kind) {
    case "birth":
    case "death": {
      const label = kind === "birth" ? "Born" : "Died";
      return { original: [label, [text(f.year), text(f.place).trim()].filter(Boolean).join(", ")].filter(Boolean).join(" "), value: { year: f.year ?? null, place: text(f.place) } };
    }
    case "event":
      return { original: text(f.label), value: { year: f.year ?? null, label: text(f.label), type: f.type ?? "note", note: text(f.note) } };
    default: // period, group
      return { original: [years(f.start, f.end), text(f.label)].filter(Boolean).join(" "), value: { start: f.start ?? null, end: f.end ?? null, label: text(f.label), note: text(f.note) } };
  }
}

const isConverted = (fact) => !!fact.preferredAssertionId;

/* ---------- dry run (pure) ---------- */

export function dryRunLegacyConversion(project) {
  const people = project.people ?? [];
  const sourceIds = new Set((project.sources ?? []).map((s) => s.id));
  const facts = Object.fromEntries(FACT_KINDS.map((k) => [k, { total: 0, alreadyConverted: 0, toConvert: 0, withSource: 0, withoutSource: 0, verified: 0, unverified: 0 }]));
  const anomalies = [];
  const sourcesToLink = new Set();
  let personsToConvert = 0, verifiedToConfirm = 0, namesToCreate = 0, sexToCreate = 0;

  for (const person of people) {
    const converted = linksOfPerson(project, person.id).some((l) => l.method === LEGACY_METHOD);
    if (!converted) {
      personsToConvert++;
      if (text(person.name).trim()) namesToCreate++; else anomalies.push({ personId: person.id, kind: "person", message: "person has no name; the persona will be called 'Unnamed'" });
      if (person.sex === "M" || person.sex === "F") sexToCreate++;
    }
    for (const { kind, fact } of factsOf(person)) {
      const row = facts[kind];
      row.total++;
      if (fact.verified) row.verified++; else row.unverified++;
      const hasSource = !!fact.sourceId;
      if (hasSource) row.withSource++; else row.withoutSource++;
      if (hasSource && !sourceIds.has(fact.sourceId)) anomalies.push({ personId: person.id, kind, message: `sourceId ${fact.sourceId} is not in the project's sources; the legacy source will be cited instead` });
      if (fact.verified && !hasSource) anomalies.push({ personId: person.id, kind, message: "verified without a source" });
      if (kind === "period" || kind === "group") {
        if (fact.start != null && fact.end != null && fact.start > fact.end) anomalies.push({ personId: person.id, kind, message: `start ${fact.start} is after end ${fact.end}` });
      }
      if (kind === "event" && fact.year == null) anomalies.push({ personId: person.id, kind, message: "event without a year" });
      if (isConverted(fact)) { row.alreadyConverted++; continue; }
      row.toConvert++;
      if (fact.verified) verifiedToConfirm++;
      if (hasSource && sourceIds.has(fact.sourceId)) {
        const src = project.sources.find((s) => s.id === fact.sourceId);
        if (!src.librarySourceId) sourcesToLink.add(src.id);
      }
    }
  }
  const factTotal = FACT_KINDS.reduce((n, k) => n + facts[k].toConvert, 0);
  const media = people.reduce((n, p) => n + (p.media?.length ?? 0), 0);
  return {
    people: people.length,
    facts,
    wouldCreate: {
      anchor: project.legacyEvidence ? 0 : 1,         // the "Legacy Meridian data" source + snapshot copy
      records: personsToConvert, personas: personsToConvert, links: personsToConvert,
      assertions: { name: namesToCreate, sex: sexToCreate, facts: factTotal, total: namesToCreate + sexToCreate + factTotal },
      sourcesToLink: sourcesToLink.size,
    },
    verifiedToConfirm,
    noTarget: [
      { field: "person.media (pins to sources)", count: media },
      { field: "project.annotations (research braces)", count: project.annotations?.length ?? 0 },
      { field: "project.eras", count: project.eras?.length ?? 0 },
    ].filter((x) => x.count),
    anomalies,
  };
}

export function formatDryRun(r) {
  const L = [`Legacy facts: ${r.people} people`];
  for (const k of FACT_KINDS) {
    const f = r.facts[k];
    L.push(`  ${k}: ${f.total} (to convert ${f.toConvert}, already ${f.alreadyConverted}; with source ${f.withSource}, without ${f.withoutSource}; verified ${f.verified}, unverified ${f.unverified})`);
  }
  const w = r.wouldCreate;
  L.push(`Would create: ${w.records} records, ${w.personas} personas, ${w.links} links, ${w.assertions.total} assertions (${w.assertions.name} names, ${w.assertions.sex} sex, ${w.assertions.facts} facts), link ${w.sourcesToLink} sources${w.anchor ? ", the 'Legacy Meridian data' source" : ""}`);
  L.push(`Verified facts to confirm in the second step: ${r.verifiedToConfirm}`);
  if (r.noTarget.length) L.push(`Stay in the project (no evidence target): ${r.noTarget.map((x) => `${x.field} ${x.count}`).join("; ")}`);
  if (r.anomalies.length) L.push(`Anomalies: ${r.anomalies.length}`);
  return L.join("\n");
}

/* ---------- conversion (user action) ---------- */

async function ensureAnchor({ library, saveBlob, project }) {
  const existing = project.legacyEvidence;
  if (existing && (await library.sources.get(existing.librarySourceId))) return { anchor: existing, created: false };
  const source = await library.sources.create({
    kind: "other", title: "Legacy Meridian data",
    citation: `Meridian project "${project.name}": facts entered before the evidence layer existed.`,
  });
  const snapshot = {
    projectId: project.id, name: project.name, snapshotAt: new Date().toISOString(),
    people: (project.people ?? []).map(({ id, name, sex, birth, death, events, periods, groups }) => ({ id, name, sex, birth, death, events, periods, groups })),
    sources: (project.sources ?? []).map(({ blobKey, text: t, ...rest }) => rest),
  };
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
  const blobKey = `legacy_${project.id}_${Date.now()}.json`;
  await saveBlob(blobKey, blob);
  const { copy } = await library.copies.registerFile(blob, {
    sourceId: source.id, fileName: "legacy-meridian-data.json", mimeType: "application/json", storage: { mode: "blob", blobKey },
  });
  const { wholePageRegion } = await library.pages.addPage({ copyId: copy.id, pageIndex: 0, label: "legacy", width: 1, height: 1 });
  return { anchor: { librarySourceId: source.id, copyId: copy.id, regionId: wholePageRegion.id, convertedAt: new Date().toISOString(), runIds: [] }, created: true };
}

/**
 * USER ACTION. Convert every not-yet-converted person and fact. Returns { project, created, reused, warnings };
 * the caller persists `project`. Throws before returning if anything fails (the project is then unchanged).
 */
export async function convertLegacyFacts({ library, loadBlob, saveBlob, project, decidedBy = LEGACY_METHOD }) {
  const warnings = [];
  const created = { anchor: 0, records: 0, personas: 0, links: 0, assertions: 0, sourcesLinked: 0 };
  const reused = { assertions: 0 };
  let next = project;

  const plan = dryRunLegacyConversion(project);
  const nothingToDo = project.legacyEvidence && plan.wouldCreate.records === 0 && FACT_KINDS.every((k) => plan.facts[k].toConvert === 0);
  if (nothingToDo) return { project, created, reused, warnings };

  const { anchor, created: anchorCreated } = await ensureAnchor({ library, saveBlob, project: next });
  if (anchorCreated) created.anchor = 1;
  const run = await library.runs.startRun({ processor: "import", processorVersion: "legacy-1", parameters: { projectId: project.id, scope: "legacy-facts" } });
  const cite = async (fact) => {
    if (fact.sourceId) {
      const src = (next.sources ?? []).find((s) => s.id === fact.sourceId);
      if (src) {
        if (!src.librarySourceId) {
          const r = await linkProjectSourceToLibrary({ library, loadBlob, project: next, sourceId: src.id });
          next = r.project; created.sourcesLinked++; warnings.push(...r.warnings.map((w) => `source "${src.title}": ${w}`));
          return { sourceId: r.librarySourceId };
        }
        return { sourceId: src.librarySourceId };
      }
    }
    return { sourceId: anchor.librarySourceId };
  };

  try {
    for (const person of [...(next.people ?? [])]) {
      let link = linksOfPerson(next, person.id).find((l) => l.method === LEGACY_METHOD && l.status === "accepted");
      let personaId = link?.personaId;
      const personaAssertions = async () => (personaId ? await library.assertions.listBySubject(personaId) : []);

      if (!personaId) {
        const { personas } = await library.records.createRecord({
          kind: "other", regionIds: [anchor.regionId], runId: run.id,
          personas: [{ nameAsWritten: text(person.name).trim() || "Unnamed", role: "subject" }],
        });
        personaId = personas[0].id; created.records++; created.personas++;
        const added = addLink(next, { personId: person.id, personaId, method: LEGACY_METHOD, rationale: "Persona created from this person's legacy timeline data" });
        next = decideLink(added.project, added.link.id, "accepted", { decidedBy }).project; created.links++;
      }

      const existing = await personaAssertions();
      const propose = async (property, original, value, legacyKey, citation) => {
        const found = existing.find((a) => a.normalizedValue?.legacyKey === legacyKey);
        if (found) { reused.assertions++; return found; }
        created.assertions++;
        const a = await library.assertions.propose({
          subjectType: "persona", subjectId: personaId, property, originalValue: original,
          normalizedValue: { ...value, legacyKey }, runId: run.id, citation,
        });
        existing.push(a);
        return a;
      };
      const legacyCite = { sourceId: anchor.librarySourceId };
      if (text(person.name).trim()) await propose("x-legacy.name", text(person.name).trim(), { name: text(person.name).trim() }, `${person.id}#name`, legacyCite);
      if (person.sex === "M" || person.sex === "F") await propose("x-legacy.sex", person.sex, { sex: person.sex }, `${person.id}#sex`, legacyCite);

      const patches = new Map(); // fact key -> { assertionIds, preferredAssertionId }
      for (const { kind, fact, key } of factsOf(next.people.find((p) => p.id === person.id))) {
        if (isConverted(fact)) continue;
        const d = describeFact(kind, fact);
        const a = await propose(PROPERTY[kind], d.original, d.value, key, await cite(fact));
        patches.set(key, { assertionIds: [a.id], preferredAssertionId: a.id });
      }
      if (patches.size) {
        next = {
          ...next,
          people: next.people.map((p) => {
            if (p.id !== person.id) return p;
            const apply = (kind, f) => patches.get(kind === "birth" || kind === "death" ? `${p.id}#${kind}` : `${p.id}#${kind}:${f.id}`);
            const patchOf = (kind, f) => { const x = apply(kind, f); return x ? { ...f, ...x } : f; };
            return {
              ...p,
              birth: p.birth && typeof p.birth === "object" ? patchOf("birth", p.birth) : p.birth,
              death: p.death && typeof p.death === "object" ? patchOf("death", p.death) : p.death,
              events: (p.events ?? []).map((f) => patchOf("event", f)),
              periods: (p.periods ?? []).map((f) => patchOf("period", f)),
              groups: (p.groups ?? []).map((f) => patchOf("group", f)),
            };
          }),
        };
      }
    }
    await library.runs.finishRun(run.id, "succeeded");
  } catch (err) {
    await library.runs.finishRun(run.id, "failed").catch(() => {});
    throw err;
  }

  next = { ...next, legacyEvidence: { ...anchor, runIds: [...(anchor.runIds ?? []), run.id] } };
  return { project: next, created, reused, warnings };
}

/* ---------- confirmation of verified facts (user action) ---------- */

async function verifiedFacts(project) {
  const out = [];
  for (const person of project.people ?? []) for (const { kind, fact } of factsOf(person)) if (fact.verified && fact.preferredAssertionId) out.push({ personId: person.id, kind, fact });
  return out;
}

/** How many verified facts still wait for their one-time confirmation. */
export async function countLegacyVerifiedPending({ library, project }) {
  let n = 0;
  for (const { fact } of await verifiedFacts(project)) {
    const a = await library.assertions.get(fact.preferredAssertionId);
    if (a && a.status === "proposed") n++;
  }
  return n;
}

/** USER ACTION (a deliberate click showing the count first): confirm the assertions of facts marked verified. */
export async function confirmLegacyVerified({ library, project, decidedBy = LEGACY_VERIFIED_BY }) {
  const result = { confirmed: 0, alreadyConfirmed: 0, skipped: 0 };
  for (const { fact } of await verifiedFacts(project)) {
    const a = await library.assertions.get(fact.preferredAssertionId);
    if (!a) { result.skipped++; continue; }
    if (a.status === "confirmed") { result.alreadyConfirmed++; continue; }
    if (a.status === "rejected") { result.skipped++; continue; }
    await library.assertions.confirmAssertion(a.id, { decidedBy });
    result.confirmed++;
  }
  return result;
}

/* ---------- keep `verified` consistent (user action) ---------- */

/**
 * The researcher toggled `verified` on a fact that has been converted. Keeps "verified <=> preferred assertion
 * is confirmed": verifying confirms the preferred assertion (or re-proposes then confirms if it was rejected);
 * un-verifying adds a new PROPOSED copy as the preferred assertion (the confirmed one stays in the history).
 * Returns the fact fields to merge: { assertionIds, preferredAssertionId }.
 */
export async function setFactVerified({ library, fact, verified, runId, decidedBy = "user" }) {
  if (!fact.preferredAssertionId) return null; // not converted: the plain flag is all there is
  const current = await library.assertions.get(fact.preferredAssertionId);
  if (!current) throw new Error(`preferred assertion ${fact.preferredAssertionId} not found`);
  const ids = Array.isArray(fact.assertionIds) ? fact.assertionIds : [];
  const repropose = async () => {
    const copy = await library.assertions.propose({
      subjectType: current.subjectType, subjectId: current.subjectId, property: current.property,
      originalValue: current.originalValue, normalizedValue: current.normalizedValue,
      runId: runId ?? current.runId, citation: current.citation, confidence: current.confidence,
    });
    return copy;
  };
  if (verified) {
    if (current.status === "confirmed") return { assertionIds: ids, preferredAssertionId: current.id };
    let target = current;
    if (current.status === "rejected") target = await repropose();
    await library.assertions.confirmAssertion(target.id, { decidedBy });
    return { assertionIds: ids.includes(target.id) ? ids : [...ids, target.id], preferredAssertionId: target.id };
  }
  if (current.status !== "confirmed") return { assertionIds: ids, preferredAssertionId: current.id }; // already not verified
  const copy = await repropose();
  return { assertionIds: [...ids, copy.id], preferredAssertionId: copy.id };
}
