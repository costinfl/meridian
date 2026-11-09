# Meridian Evidence Layer — Implementation Plan

Target design: `evidence-model.md` · Progress tracking: `PROGRESS.md` · Platform decision: `docs/adr/0005-evidence-layer-runs-client-side.md` (all in this repo).

This plan is written for an AI coding agent working in the Meridian repository. It is executed in phases; **the agent stops at the end of every phase for human review** and resumes only after approval.

Meridian is a client-only Vite 5 + React 18 app. Data lives in IndexedDB; tests run with Vitest, jsdom and `fake-indexeddb`; every push to `master` is deployed to GitHub Pages. There is no backend, and none may be added without a new ADR approved by the reviewer.

---

## 1. Operating rules for the agent

### Starting or resuming a session
1. Read `PROGRESS.md` first, then this plan, then `evidence-model.md` and the ADRs in `docs/adr/`.
2. Find **Current status** and **Next action** in `PROGRESS.md`. Continue exactly from there.
3. If the current phase is `awaiting review`, do **not** start new work. Check the phase's review section for `Approved: yes`. If it is not there, report that you are waiting for review and stop.
4. Install the latest npm first, as CI does (`npm install -g npm@latest`, or `npx -y npm@latest ci` if a global install is not possible), then run `npm ci`, `npm test -- --run` and `npm run build` before changing anything. Do not regenerate `package-lock.json`. If anything fails, record it in `PROGRESS.md` and fix it before new work (or stop and ask, if the cause is outside the plan).

### Working on tasks
- Work on **one task at a time**, in the order listed, using its ID (e.g. `P2.T3`).
- A task is `done` only when its acceptance criteria are met, `npm test -- --run` and `npm run build` pass, and new behaviour has tests.
- After each task:
  1. Update `PROGRESS.md`: task status, files touched (short list), notes, and the new **Next action**.
  2. Commit with the message `P<phase>.T<task>: <summary>` on the phase branch `evidence/p<phase>`.
- If a task is blocked, set it to `blocked`, write the reason and what you need under **Open questions**, and continue with the next independent task of the same phase; otherwise stop.
- Do not implement anything from a later phase. Put ideas under **Backlog ideas**.

### Deployment safety (every push to `master` goes live)
- Never push to `master`. Work on `evidence/p<N>`; at phase end open a pull request to `master` and stop. The reviewer merges.
- `master` must always build and pass tests. Unfinished evidence UI is hidden behind a feature flag (`project.settings.evidenceUi`, default `false`, plus `?evidence=1` in the URL for testing) until the reviewer turns it on.
- Any IndexedDB version upgrade must keep existing projects and blobs intact, proven by a test that creates a database at the previous version with sample data, upgrades it, and checks everything survived. The phase report must remind the reviewer to **export a native bundle backup before merging**.
- New dependencies must work in a static site (no server). Large assets (OCR language data, pdf.js worker) are loaded lazily, only when the evidence features are used.

### Changing the design
- `evidence-model.md` and the accepted ADRs are the contract. If code or a library forces a deviation, choose the smallest one, record it in the **Decisions & deviations log** (what, why, alternatives), and flag it in the phase report. A decision that changes an ADR needs a new ADR (status Proposed) for the reviewer.
- Never weaken these invariants. Each must be covered by a test in the phase that introduces it:
  - **I1** Assertions and text layers are append-only: the repository layer offers no update of content fields and no delete. Corrections supersede.
  - **I2** Every assertion has a citation region, except agent `manual` (source + page label) and agent `import` (source).
  - **I3** Every text layer, assertion and conclusion references its agent/run.
  - **I4** Region boxes are normalised to 0–1 in unrotated page coordinates.
  - **I5** Evidence code never imports conclusion or UI code (`src/evidence/**` imports nothing from `src/conclusions/**`, `src/components/**`, `src/App.jsx`).
  - **I6** Nothing becomes `accepted` or `confirmed` without an explicit user action.
  - **I7** Search index and graph projection can be fully rebuilt from the stores, and the rebuild equals the incremental result.
  - **I8** Existing projects, blobs and native bundles keep working: database upgrades are lossless, bundle export → import round-trips without loss, GEDCOM export of an untouched project is unchanged.
  - **I9** API keys and folder handles never leave the device: never in bundles, exports, logs or the repo.

### Ending a phase
1. All tasks `done` (or explicitly `deferred` with a reason).
2. Write the **Phase report** in `PROGRESS.md`: what was built, deviations, IndexedDB version and stores added, new dependencies (name, version, size), how to verify (exact commands and manual steps on `npm run dev`), known limitations, questions for the reviewer.
3. Set the phase to `awaiting review`, set **Next action** to "Wait for review of Phase N", push the branch, open the pull request, and **stop**.

### General engineering rules
- Plain JavaScript and the existing style: ES modules, React function components, inline styles with tokens from `src/theme.js`. No TypeScript, UI libraries or Tailwind unless the reviewer approves.
- Persistence only through `StorageService` and its adapter; components never call IndexedDB directly.
- Long work (PDF rendering, OCR, indexing, entity resolution) runs in Web Workers with progress reporting and cancellation.
- No `localStorage` (existing project rule). Secrets go in an IndexedDB `settings` store, never in source code or bundles.
- Tests use Vitest with `fake-indexeddb`; workers and heavy libraries are tested through pure functions or stubs, with a few fixture-based integration tests.

---

## 2. Phases overview

| Phase | Goal | Review focus |
| --- | --- | --- |
| 0 | Discovery: confirm the codebase facts and choose libraries; no code changes | Mapping, library choices, browser support |
| 1 | Foundation: folders, architecture test, CI tests, IndexedDB upgrade framework, feature flag | App unchanged; upgrade is lossless |
| 2 | Layers 1–2: library sources, copies, pages, regions, runs, text layers | Store design and invariants I1, I3, I4 |
| 3 | Layer 3 + places, names, dates | Evidence model, FuzzyDate, normalisation |
| 4 | Conclusions: families, links, legacy facts as assertions, bundle v2 | Data integrity, GEDCOM unchanged |
| 5 | Ingestion v1: linked folder, PDF/DOCX text, OCR, router | End to end on real documents |
| 6 | Extraction contract, LLM extractor, review UI | Proposal quality, review speed |
| 7 | Search | Results on real data |
| 8 | Graph projection | FAN and kinship queries |
| 9 | Entity resolution | Candidate quality, review flow |
| Backlog | Transkribus, Arcanum, local companion, embeddings, gazetteer | Prioritised by the reviewer |

---

## Phase 0 — Discovery (no production code changes)

| ID | Task | Acceptance |
| --- | --- | --- |
| P0.T1 | Confirm the environment facts already listed in `PROGRESS.md` (versions, scripts, CI workflow, storage adapter, test setup) and correct anything wrong. Note that `README.md` still describes the single-file `App.jsx` version. | **Environment facts** confirmed or corrected. |
| P0.T2 | Map the existing model (`src/models/project.js`, `sampleData.js`, `gedcom.js`, `share.js`, `useProject.js`) to the design: person facts, `fatherId`/`motherId`/`spouseIds`, `project.sources`, `verified`, `sourceId`, annotations, media pins. Count how many facts have a `sourceId` and how many are `verified` in the sample data. | Mapping table in `PROGRESS.md`. |
| P0.T3 | List every place in the code that reads or writes `fatherId`, `motherId`, `spouseIds`, `verified`, `sourceId`, so the impact of Phase 4 is known. | List with file and line. |
| P0.T4 | Evaluate libraries and propose one per need, with version, licence, bundle/asset size and a one-line reason: PDF (pdf.js), DOCX (mammoth), OCR (tesseract.js + `ron` traineddata, self-hosted vs CDN), search (MiniSearch or FlexSearch), Daitch–Mokotoff and Jaro–Winkler (library vs own implementation), JSON Schema validation (e.g. Ajv), graph (plain maps vs graphology). | Proposal table in `PROGRESS.md`. |
| P0.T5 | Check browser support for `showDirectoryPicker`, persisting directory handles, `navigator.storage.persist()` and module Web Workers in the user's browser (Chromium assumed) and in Vite builds. Check whether the intended LLM provider allows direct browser (CORS) calls. | Findings and fallbacks recorded. |
| P0.T6 | Propose the folder layout: `src/evidence/` (stores, repositories, domain), `src/conclusions/`, `src/ingest/`, `src/search/`, `src/graph/`, `src/workers/`, `src/components/evidence/`. | Proposal with what existing code stays where. |
| P0.T7 | Record baseline: `npm ci`, `npm test -- --run`, `npm run build` results and test count. | Baseline recorded. |

**Reviewer checks:** mapping is right; confirm "Family is the source of truth, legacy fields derived"; approve libraries and folder layout.

---

## Phase 1 — Foundation (no visible behaviour change)

| ID | Task | Acceptance |
| --- | --- | --- |
| P1.T1 | Create the approved folders with index files. Move nothing that is not needed yet. | App behaves exactly as before. |
| P1.T2 | Architecture test in Vitest that scans imports under `src/evidence/**`, `src/search/**`, `src/graph/**` and enforces **I5** (and that UI is only imported from UI). | Test passes; a deliberate bad import makes it fail (shown in the phase report, then removed). |
| P1.T3 | CI: add a test job (`npm ci`, `npm test -- --run`) that must pass before the Pages build job runs. | Workflow updated; a failing test blocks deployment. |
| P1.T4 | IndexedDB upgrade framework in the adapter: versioned, forward-only upgrade steps (version 1 → 2 creates an empty `settings` store only). Migration test per **I8**: version-1 database with projects and blobs upgrades losslessly. | Test passes; `listProjects`, `loadProject`, `loadBlob` unchanged. |
| P1.T5 | Feature flag `evidenceUi` (project setting + `?evidence=1`) and an empty "Evidence" entry point visible only when enabled. | Hidden by default; visible with the flag. |
| P1.T6 | `navigator.storage.persist()` request when evidence features are enabled, plus a status line showing persistence state, storage estimate and the time of the last native bundle export. | Works in Chromium; degrades silently elsewhere. |

**Reviewer checks:** deployed app unchanged; export a bundle backup, then merge.

---

## Phase 2 — Library sources and text (Layers 1–2)

| ID | Task | Acceptance |
| --- | --- | --- |
| P2.T1 | IndexedDB version 3: stores `evRepositories`, `evSources`, `evCopies`, `evPages`, `evRegions`, `evRuns`, `evRunItems`, `evRawOutputs`, `evTextLayers`, `evPageCache`, with indexes (e.g. copies by SHA-256, pages by copyId, regions by pageId, text layers by regionId). | Upgrade test (**I8**). |
| P2.T2 | Repository functions for Repository and LibrarySource (create, read, list, update metadata; parent hierarchy). | Tests incl. hierarchy. |
| P2.T3 | DigitalCopy registration by SHA-256 (`crypto.subtle`): same hash returns the existing copy. Storage mode `blob` (blobKey) or `folder` (relative path). | Duplicate-hash test. |
| P2.T4 | Page and Region with a `normalizedBox` helper (0–1, x0<x1, y0<y1), optional polygon, nesting, automatic whole-page region per page. | **I4** tests. |
| P2.T5 | ProcessingRun, ProcessingRunItem, RawOutput (byte-exact round trip). | Tests. |
| P2.T6 | TextLayer with `supersedesId`; append-only repository (**I1**), run required (**I3**); `currentTextLayer(regionId)`. | Tests, including that no update/delete function exists for content. |
| P2.T7 | Link existing `project.sources` to the library: helper that creates a LibrarySource + DigitalCopy from an existing source and its blob and stores `librarySourceId` on the project source. Not run automatically yet. | Test on a sample project; project otherwise unchanged. |

**Reviewer checks:** store layout; invariants; backup before merge.

---

## Phase 3 — Evidence, places, names, dates

| ID | Task | Acceptance |
| --- | --- | --- |
| P3.T1 | `FuzzyDate` module: construct from a stated date, a year, "about/before/after", or a stated age at an event date; compute `earliest`/`latest` and day numbers; overlap test. Julian/Gregorian flag stored (no conversion yet unless trivial). | Unit tests, including "45 ani" at 1885-03-01. |
| P3.T2 | Stores (IndexedDB version 4) `evPlaces`, `evPlaceNames`, `evPlaceParents`, `evNameVariants`, `evRecords`, `evPersonas`, `evAssertions`, with indexes (assertions by subject, by citation region, by status; personas by record; records by day range). | Upgrade test (**I8**). |
| P3.T3 | Places: names valid at a date; ancestors of a place at a date (civil and church). | Test with a place that changed name and parent. |
| P3.T4 | Normalisation module: Romanian folding (ş→ș, ţ→ț, then accent-insensitive key, lower case) and Daitch–Mokotoff codes. | Tests: "Ştefan" / "Ștefan" / "Stefan" share a key; DM codes match published test vectors for sample surnames. |
| P3.T5 | Record and Persona repositories. | Tests. |
| P3.T6 | Assertion repository: append-only, `supersedesId`, citation rules, status changes only via `confirmAssertion` / `rejectAssertion` called by user-action code. | Tests for **I1**, **I2**, **I3**, **I6**. |
| P3.T7 | `personaView(personaId)`: current confirmed assertions folded into persona fields. | Superseded and rejected assertions excluded. |

**Reviewer checks:** FuzzyDate behaviour, normalisation examples, assertion workflow.

---

## Phase 4 — Conclusions, legacy facts and bundle v2

| ID | Task | Acceptance |
| --- | --- | --- |
| P4.T1 | Project model: `families`, `personaLinks`, `relationships`, `conclusionEvidence`, `proofNotes`, and `assertionIds` / `preferredAssertionId` on facts, added through `normalizeProject` (older projects upgrade transparently). | Model tests; old projects load unchanged. |
| P4.T2 | Families as source of truth: on upgrade, build families from `fatherId`/`motherId`/`spouseIds`; afterwards `normalizeProject` derives those fields from families. Edits in the UI go through family functions. | Round-trip test on sample data: derived fields equal the originals; relationship inference and GEDCOM FAM output unchanged (**I8**). |
| P4.T3 | Legacy facts as evidence, **dry run first**: report (counts per fact type, with/without `sourceId`, verified/unverified) without writing. | Report in the phase report. |
| P4.T4 | Legacy facts as evidence: create a "Legacy Meridian data" LibrarySource; for each fact create import-agent assertions citing its source (via P2.T7) or the legacy source (a birth or death is split into a date and a place assertion; other facts get one); the legacy persona is linked to its person as a `candidate` that the user accepts per person; all facts start `proposed` (including `verified` ones); a one-time user step ("Confirm legacy verified facts", showing the count and requiring a click) then confirms the `verified` ones with decidedBy `legacy-verified`; set `preferredAssertionId`. Idempotent. | Counts match the dry run; running twice changes nothing. |
| P4.T5 | Keep `verified` consistent: a fact is verified ⇔ its preferred assertion is confirmed; toggling verified in `ItemModal` confirms or re-proposes through the assertion functions (a user action). Editing a converted fact's content creates a user-entered assertion that supersedes the old one. | Tests; GEDCOM export of the sample project byte-identical before and after (**I8**). |
| P4.T6 | Native bundle v2: `evidence.json` with the library entities the project references; import merges by id and copy hash, never overwriting; bundles without `evidence.json` still import. Recorded in ADR-0006 (extends ADR-0002). | Round-trip test; old-bundle import test; **I9** test (no keys or handles in output). |
| P4.T7 | Display name: a person is shown under the first name identified for them (earliest-linked persona name); the user can choose "Display person with this name instead" for any other linked name. Display only: nothing is merged, renamed or re-linked. | Tests: default is the first-identified name; override persists; export (bundle) round-trips it; GEDCOM export unchanged unless the reviewer asks otherwise. |

**Reviewer checks:** spot-check 10 people and their families in the app; GEDCOM diff empty; backup before merge.

---

## Phase 5 — Ingestion v1 (folder, text, OCR)

| ID | Task | Acceptance |
| --- | --- | --- |
| P5.T1 | Link a documents folder with `showDirectoryPicker()`; store the handle in IndexedDB; re-request permission on new sessions. Fallback: multi-file picker and drag-and-drop (stored as blobs). | Manual test steps documented; fallback tested. |
| P5.T2 | Scanner: walk the folder, hash files (PDF, DOCX, JPG/PNG/TIFF), register copies; unknown files go to an "Inbox" until linked to a LibrarySource. Optional sidecar `<file>.meta.json` (source title, repository, date, page label, access URL) — format documented. | Re-scan creates no duplicates; moved/renamed files recognised by hash. A same-name file with different bytes is flagged as a possible version and offered **keep both / replace** (library functions exist since the Phase 2 review follow-up). |
| P5.T3 | pdf.js in a worker: page count, size, rotation → Page rows; render pages to the disposable cache on demand. DOCX via mammoth → one text page. Legacy `.doc` → clear "convert to DOCX/PDF" message. pdf.js, OCR WASM core and `ron` data are **self-hosted**, copied from `node_modules` into the build at build time (not committed) and loaded lazily. | Cache can be cleared and regenerated; build output contains the assets. |
| P5.T4 | Router run: use pdf.js embedded text (with word boxes) if it passes a quality check (share of plausible words, configurable); otherwise queue OCR; sources flagged handwritten → "awaiting HTR". | Classification stored per run item. |
| P5.T5 | OCR with tesseract.js in a worker (`ron` default, languages configurable, language data loaded lazily); word boxes converted to normalised coordinates; raw output stored; versions on the run. | Fixture tests: text PDF, scanned PDF page, DOCX. |
| P5.T6 | Evidence panel (behind the flag): runs and items with status, failed-item re-run as a one-page batch, progress and cancel. | Manual test steps in the phase report. |

**Reviewer checks:** run on 5–10 real documents, including an Arcanum PDF export and a scanned register; judge text quality and speed (seconds per page). Decide here whether the local companion (Backlog) is needed.

---

## Phase 6 — Extraction contract and review

| ID | Task | Acceptance |
| --- | --- | --- |
| P6.T1 | Extraction contract v1 as a JSON Schema file (record, personas, assertions with region references and original/normalised values) plus a validator. | Valid and invalid fixtures tested. |
| P6.T2 | Region drawing on a page image and manual entry of a record, personas and assertions (agent `manual`, confirmed on save as a user action). | Component tests for the form logic. |
| P6.T3 | LLM extractor: provider/model/key in the `settings` store (key entry UI, never exported, **I9**); versioned prompt file; output validated; valid → proposed assertions, invalid → failed run item with the validation error; page limit per batch and dry-run mode. | Tests with a stubbed client; no real API calls in tests. |
| P6.T4 | Review queue: proposed assertions with their region crop; confirm, reject, correct (a correction is a new assertion superseding the proposal); rejected proposals are not re-proposed for the same region and property. | **I6** tests. |
| P6.T5 | Connect evidence to the timeline: from a person fact, see its assertions and their crops; attach a confirmed assertion to a fact. | Manual test steps. |

**Reviewer checks:** extract a few real pages; judge quality and review speed; decide prompt changes and whether to turn the flag on by default.

---

## Phase 7 — Search

| ID | Task | Acceptance |
| --- | --- | --- |
| P7.T1 | Index builder in a worker: one document per region (current text layer, normalised text, DM codes of persona names, name variants, date bounds, place ancestry, source kind); serialised to `evSearchIndex`. | Full rebuild; **I7** test (rebuild equals incremental). |
| P7.T2 | Incremental updates when text layers or assertions are added. | Tests. |
| P7.T3 | Query: names expanded through NameVariants and DM codes; fuzzy text; filters by date range, place, source kind, project scope. | Tests: "Ioan" finds "Iohannes" (variant) and DM matches; "Stefan" finds "Ştefan". |
| P7.T4 | Search UI with result crops and a jump to the page. | Manual test steps; acceptable speed on the reviewer's data. |

**Reviewer checks:** search quality and speed on real data.

---

## Phase 8 — Graph projection

| ID | Task | Acceptance |
| --- | --- | --- |
| P8.T1 | Graph module: builds the projection from the stores and the project (nodes and edges as in the design); the only module other code uses for graph queries. | Rebuild test on fixtures. |
| P8.T2 | Incremental updates on writes. | **I7** test. |
| P8.T3 | FAN queries: neighbourhood of a persona or person, bounded to 1–2 hops, filters by role and date range; candidate clusters as connected components over candidate SAME_AS links. | Fixture tests. |
| P8.T4 | Kinship: ancestors, descendants, common ancestors with a visited set; replaces or backs the existing relationship inference only if results match. | Endogamous fixture terminates with correct results. |
| P8.T5 | FAN view for a person (list or small graph, theme tokens). | Manual test steps. |

**Reviewer checks:** FAN results on real data.

---

## Phase 9 — Entity resolution

| ID | Task | Acceptance |
| --- | --- | --- |
| P9.T1 | Blocking: candidate pairs by phonetic surname key + birth decade + parish (configurable). | Tests; pair counts reported. |
| P9.T2 | Comparators: Jaro–Winkler on normalised names, date overlap, place compatibility, FAN overlap. | Unit tests per comparator. |
| P9.T3 | Weighted scoring in a worker; each run is a ProcessingRun (`entity-resolution`); results are `candidate` PersonaLinks with per-signal breakdown; rejected pairs are never re-proposed. | **I6** and rejected-pair tests. |
| P9.T4 | Review queue: accept, reject, link to another person, or create a new person; accepted links can propose NameVariant pairs for confirmation. | End-to-end test of the logic. |
| P9.T5 | Calibration report: acceptance rate per score band and per signal. | Report from fixture decisions. |

**Reviewer checks:** candidate quality on real data; weights.

---

## Backlog (not scheduled; the reviewer prioritises)

- **Local ingest companion (separate repo)** — only if Phase 5/6 show in-browser OCR, HTR or external APIs are impractical. A small local program (Java is fine) that watches the documents folder, runs Tesseract/Transkribus/Arcanum, and writes bundle-format `evidence.json` for Meridian to import. Requires a new ADR.
- Transkribus processor for handwritten registers (PAGE XML → regions and text layers).
- Arcanum Newspaper Segmentation processor (rotated coordinates → normalised boxes).
- Julian → Gregorian conversion helpers.
- Cyrillic and transitional-alphabet transliteration.
- In-browser embeddings and semantic search.
- Place gazetteer import (GeoNames/Wikidata) and historical administrative units.
- Keep `README.md` and `docs/user-guide.md` up to date as evidence features become visible (documentation was rewritten after Phase 4).
