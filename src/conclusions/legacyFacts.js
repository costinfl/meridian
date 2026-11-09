/*
 * Legacy timeline facts as evidence (Phase 4).
 *
 * Existing facts become import-agent assertions on an import-agent persona of their person, cited to the fact's
 * own source (when it has one) or to the "Legacy Meridian data" source:
 *   - a birth or death becomes TWO assertions: `birth.date` / `death.date` (a year-precision FuzzyDate) and
 *     `birth.place` / `death.place` (reviewer decision, Phase 4 review);
 *   - an event, period or group becomes ONE assertion with an `x-legacy.*` property and a structured value.
 * All assertions start `proposed`, and the persona is linked to its person as a CANDIDATE link: nothing is
 * confirmed or accepted by the conversion. Separate user steps do that (confirmLegacyVerified; decideLink).
 * Facts keep working exactly as before; they gain `assertionIds` (every assertion ever made for the fact) and
 * `preferredAssertionId` (the primary one: the date for a birth/death). A fact's ACTIVE assertions are those in
 * `assertionIds` that no later assertion supersedes.
 *
 *   dryRunLegacyConversion  pure, read-only: what would be converted (counts, anomalies, fields with no target)
 *   convertLegacyFacts      USER ACTION: writes the evidence and returns the updated project (caller saves it)
 *   confirmLegacyVerified   USER ACTION: confirms the assertions of verified facts
 *   applyFactEdit           USER ACTION: a fact was edited on the timeline; changed content supersedes the old
 *                           assertion, and "verified <=> its active assertions are confirmed" is kept
 *   setFactVerified         USER ACTION: only the verified flag changed
 *
 * Idempotent for completed runs: converted facts and persons are skipped, nothing is written (not even a run) when
 * there is nothing to convert, and assertions are matched by a stable key so none is proposed twice for the same
 * persona. If a run fails midway nothing is saved to the project (the caller only persists a returned project),
 * so a retry starts from the unchanged project and creates fresh personas; the records already written by the
 * failed attempt stay in the shared library as unlinked legacy personas (harmless, but noise).
 */
import { linkProjectSourceToLibrary } from "./linkLegacySource.js";
import { addLink, linksOfPerson } from "./personaLinks.js";
import { fuzzyDate } from "../evidence/domain/fuzzyDate.js";

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

const validYear = (y) => Number.isInteger(y) && y >= 1 && y <= 9999;

/**
 * The assertions a fact should have: [{ property, original, value, matches(assertion) }], primary first.
 * `matches` recognises an existing assertion of the same persona for the same fact part.
 */
function specsOf(kind, f, key) {
  const years = (a, b) => (a != null && b != null ? `${a}-${b}` : text(a ?? b));
  const keyed = (property, original, value) => ({ property, original, value: { ...value, legacyKey: key }, matches: (a) => a.normalizedValue?.legacyKey === key });
  if (kind === "birth" || kind === "death") {
    const out = [];
    if (f.year != null) {
      if (validYear(f.year)) {
        const property = `${kind}.date`;
        out.push({ property, original: String(f.year), value: fuzzyDate({ asWritten: String(f.year), year: f.year }), matches: (a) => a.property === property });
      } else {
        out.push(keyed(`x-legacy.${kind}-date`, text(f.year), { year: f.year })); // not a usable year: kept as written
      }
    }
    if (text(f.place).trim()) {
      const property = `${kind}.place`;
      out.push({ property, original: text(f.place).trim(), value: undefined, matches: (a) => a.property === property });
    }
    return out;
  }
  if (kind === "event") return [keyed(PROPERTY.event, text(f.label), { year: f.year ?? null, label: text(f.label), type: f.type ?? "note", note: text(f.note) })];
  return [keyed(PROPERTY[kind], [years(f.start, f.end), text(f.label)].filter(Boolean).join(" "), { start: f.start ?? null, end: f.end ?? null, label: text(f.label), note: text(f.note) })];
}

const isConverted = (fact) => !!fact.preferredAssertionId;

/* ---------- dry run (pure) ---------- */

export function dryRunLegacyConversion(project) {
  const people = project.people ?? [];
  const sourceIds = new Set((project.sources ?? []).map((s) => s.id));
  const facts = Object.fromEntries(FACT_KINDS.map((k) => [k, { total: 0, alreadyConverted: 0, toConvert: 0, withSource: 0, withoutSource: 0, verified: 0, unverified: 0 }]));
  const anomalies = [];
  const sourcesToLink = new Set();
  let personsToConvert = 0, verifiedToConfirm = 0, namesToCreate = 0, sexToCreate = 0, factAssertions = 0;

  for (const person of people) {
    const converted = linksOfPerson(project, person.id).some((l) => l.method === LEGACY_METHOD);
    if (!converted) {
      personsToConvert++;
      if (text(person.name).trim()) namesToCreate++; else anomalies.push({ personId: person.id, kind: "person", message: "person has no name; the persona will be called 'Unnamed'" });
      if (person.sex === "M" || person.sex === "F") sexToCreate++;
    }
    for (const { kind, fact } of factsOf(person)) {
      const row = facts[kind];
      if ((kind === "birth" || kind === "death") && fact.year != null && !validYear(fact.year)) anomalies.push({ personId: person.id, kind, message: `year ${fact.year} is not a usable year; kept as written` });
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
      row.toConvert++; factAssertions += specsOf(kind, fact, "k").length;
      if (fact.verified) verifiedToConfirm++;
      if (hasSource && sourceIds.has(fact.sourceId)) {
        const src = project.sources.find((s) => s.id === fact.sourceId);
        if (!src.librarySourceId) sourcesToLink.add(src.id);
      }
    }
  }
  const factTotal = factAssertions; // a birth or death gives up to two assertions (date, place)
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
  L.push(`Would create: ${w.records} records, ${w.personas} personas, ${w.links} candidate links, ${w.assertions.total} assertions (${w.assertions.name} names, ${w.assertions.sex} sex, ${w.assertions.facts} for facts; a birth or death gives a date and a place assertion), link ${w.sourcesToLink} sources${w.anchor ? ", the 'Legacy Meridian data' source" : ""}`);
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
export async function convertLegacyFacts({ library, loadBlob, saveBlob, project }) {
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
      const link = linksOfPerson(next, person.id).find((l) => l.method === LEGACY_METHOD); // any status: the persona exists
      let personaId = link?.personaId;
      const personaAssertions = async () => (personaId ? await library.assertions.listBySubject(personaId) : []);

      if (!personaId) {
        const { personas } = await library.records.createRecord({
          kind: "other", regionIds: [anchor.regionId], runId: run.id,
          personas: [{ nameAsWritten: text(person.name).trim() || "Unnamed", role: "subject" }],
        });
        personaId = personas[0].id; created.records++; created.personas++;
        // a CANDIDATE link: the researcher accepts each one (reviewer decision, Phase 4 review)
        next = addLink(next, { personId: person.id, personaId, method: LEGACY_METHOD, rationale: "Persona created from this person's legacy timeline data" }).project; created.links++;
      }

      const existing = await personaAssertions();
      const propose = async (spec, citation) => {
        const found = existing.find(spec.matches);
        if (found) { reused.assertions++; return found; }
        created.assertions++;
        const a = await library.assertions.propose({
          subjectType: "persona", subjectId: personaId, property: spec.property, originalValue: spec.original,
          normalizedValue: spec.value, runId: run.id, citation,
        });
        existing.push(a);
        return a;
      };
      const keyed = (property, original, value, key) => ({ property, original, value: { ...value, legacyKey: key }, matches: (a) => a.normalizedValue?.legacyKey === key });
      const legacyCite = { sourceId: anchor.librarySourceId };
      if (text(person.name).trim()) await propose(keyed("x-legacy.name", text(person.name).trim(), { name: text(person.name).trim() }, `${person.id}#name`), legacyCite);
      if (person.sex === "M" || person.sex === "F") await propose(keyed("x-legacy.sex", person.sex, { sex: person.sex }, `${person.id}#sex`), legacyCite);

      const patches = new Map(); // fact key -> { assertionIds, preferredAssertionId }
      for (const { kind, fact, key } of factsOf(next.people.find((p) => p.id === person.id))) {
        if (isConverted(fact)) continue;
        const citation = await cite(fact);
        const ids = [];
        for (const spec of specsOf(kind, fact, key)) ids.push((await propose(spec, citation)).id);
        if (ids.length) patches.set(key, { assertionIds: ids, preferredAssertionId: ids[0] });
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

/* ---------- a fact's assertions ---------- */

/** Assertions of a fact that no later assertion supersedes (effective statuses). */
export async function activeAssertionsOf(library, fact) {
  const all = (await Promise.all((fact.assertionIds ?? []).map((id) => library.assertions.get(id)))).filter(Boolean);
  const superseded = new Set(all.map((a) => a.supersedesId).filter(Boolean));
  return all.filter((a) => !superseded.has(a.id));
}

function verifiedFacts(project) {
  const out = [];
  for (const person of project.people ?? []) for (const { kind, fact, key } of factsOf(person)) if (fact.verified && fact.preferredAssertionId) out.push({ personId: person.id, kind, fact, key });
  return out;
}

/* ---------- confirmation of verified facts (user action) ---------- */

/** How many verified FACTS still wait for their one-time confirmation. */
export async function countLegacyVerifiedPending({ library, project }) {
  let n = 0;
  for (const { fact } of verifiedFacts(project)) if ((await activeAssertionsOf(library, fact)).some((a) => a.status === "proposed")) n++;
  return n;
}

/** USER ACTION (a deliberate click showing the count first): confirm the assertions of facts marked verified. */
export async function confirmLegacyVerified({ library, project, decidedBy = LEGACY_VERIFIED_BY }) {
  const result = { confirmed: 0, alreadyConfirmed: 0, skipped: 0, assertions: 0 }; // facts, except `assertions`
  for (const { fact } of verifiedFacts(project)) {
    const active = await activeAssertionsOf(library, fact);
    const todo = active.filter((a) => a.status === "proposed");
    if (!active.length || active.some((a) => a.status === "rejected")) { result.skipped++; continue; }
    if (!todo.length) { result.alreadyConfirmed++; continue; }
    for (const a of todo) { await library.assertions.confirmAssertion(a.id, { decidedBy }); result.assertions++; }
    result.confirmed++;
  }
  return result;
}

/* ---------- keeping facts and assertions consistent (user actions) ---------- */

const sameContent = (a, spec) => a.originalValue === spec.original && JSON.stringify(a.normalizedValue ?? null) === JSON.stringify(spec.value === undefined ? a.normalizedValue ?? null : spec.value);

/** A new proposed assertion with the same content, superseding `a` (same run and citation: nothing new was read). */
const reproposeAsUser = (library, a) => library.assertions.supersedeAsUser({
  subjectType: a.subjectType, subjectId: a.subjectId, property: a.property, originalValue: a.originalValue,
  normalizedValue: a.normalizedValue, runId: a.runId, citation: a.citation, confidence: a.confidence, supersedesId: a.id,
});

/**
 * USER ACTION: only the `verified` flag of a converted fact changed. Keeps "verified <=> every active assertion of
 * the fact is confirmed": verifying confirms them (a rejected one is re-proposed first); un-verifying supersedes
 * each confirmed one with a proposed copy (the confirmed ones stay in the history).
 * Returns { assertionIds, preferredAssertionId } to merge into the fact, or null if the fact is not converted.
 */
export async function setFactVerified({ library, fact, verified, decidedBy = "user" }) {
  if (!fact.preferredAssertionId) return null; // not converted: the plain flag is all there is
  const ids = [...(fact.assertionIds ?? [])];
  let preferred = fact.preferredAssertionId;
  const replace = (oldId, neu) => { ids.push(neu.id); if (preferred === oldId) preferred = neu.id; };
  for (const a of await activeAssertionsOf(library, fact)) {
    if (verified) {
      let target = a;
      if (a.status === "rejected") { target = await reproposeAsUser(library, a); replace(a.id, target); }
      if (target.status !== "confirmed") await library.assertions.confirmAssertion(target.id, { decidedBy });
    } else if (a.status === "confirmed") {
      replace(a.id, await reproposeAsUser(library, a));
    }
  }
  return { assertionIds: ids, preferredAssertionId: preferred };
}

/**
 * USER ACTION: a converted fact was edited on the timeline. `before` is the stored fact, `after` the fact with the
 * new values (same id). For each part whose content changed, a new assertion entered by the user (agent `manual`)
 * supersedes the old one; a part that did not exist before (e.g. a place added to a birth) gets a new assertion.
 * Then the verified rule is applied to the result. A part that was REMOVED keeps its old assertion (evidence is
 * never deleted). Returns { assertionIds, preferredAssertionId } or null when the fact is not converted.
 */
export async function applyFactEdit({ library, kind, personId, before, after, decidedBy = "user" }) {
  if (!before?.preferredAssertionId) return null;
  const active = await activeAssertionsOf(library, before);
  if (!active.length) return null;
  const key = kind === "birth" || kind === "death" ? `${personId}#${kind}` : `${personId}#${kind}:${before.id}`;
  const ids = [...(before.assertionIds ?? [])];
  let preferred = before.preferredAssertionId;
  let runId = null;
  const manualRun = async () => {
    if (!runId) {
      const run = await library.runs.startRun({ processor: "manual", parameters: { scope: "timeline-edit", personId } });
      await library.runs.finishRun(run.id, "succeeded");
      runId = run.id;
    }
    return runId;
  };
  // a manual assertion without a region must cite a source and a page label
  const manualCitation = (a) => (a.citation?.regionId ? { regionId: a.citation.regionId } : { sourceId: a.citation?.sourceId, pageLabel: a.citation?.pageLabel || "timeline" });

  for (const spec of specsOf(kind, after, key)) {
    const cur = active.find(spec.matches);
    if (cur && sameContent(cur, spec)) continue;
    const input = {
      subjectType: "persona", subjectId: active[0].subjectId, property: spec.property, originalValue: spec.original,
      normalizedValue: spec.value, runId: await manualRun(), citation: manualCitation(cur ?? active[0]),
    };
    const neu = cur ? await library.assertions.supersedeAsUser({ ...input, supersedesId: cur.id }) : await library.assertions.propose(input);
    ids.push(neu.id);
    if (cur && preferred === cur.id) preferred = neu.id;
  }
  return setFactVerified({ library, fact: { ...after, assertionIds: ids, preferredAssertionId: preferred }, verified: !!after.verified, decidedBy });
}
