# Meridian Evidence Layer — Implementation Plan

Target design: `evidence-model.md` (same folder). Progress tracking: `PROGRESS.md` (same folder).

This plan is written for an AI coding agent working in the Meridian repository. It is executed in phases; **the agent stops at the end of every phase for human review** and resumes only after approval.

---

## 1. Operating rules for the agent

### Starting or resuming a session
1. Read `PROGRESS.md` first, then this plan, then `evidence-model.md`.
2. Find **Current status** and **Next action** in `PROGRESS.md`. Continue exactly from there.
3. If the current phase is marked `awaiting review`, do **not** start new work. Check whether the review section of that phase contains `Approved: yes`. If not, report that you are waiting for review and stop.
4. Run the full build and test suite before changing anything. If it fails, record the failure in `PROGRESS.md` and fix it before new work (or stop and ask, if the cause is outside the plan).

### Working on tasks
- Work on **one task at a time**, in the order listed, using its ID (e.g. `P2.T3`).
- A task is `done` only when: its acceptance criteria are met, the build is green, and new behaviour has tests.
- After each task:
  1. Update `PROGRESS.md`: task status, files touched (short list), notes, and the new **Next action**.
  2. Commit with the message `P<phase>.T<task>: <summary>` on the phase branch `evidence/p<phase>`.
- If a task is blocked, set it to `blocked`, write the reason and what you need under **Open questions**, and move to the next independent task of the same phase if one exists; otherwise stop.
- Do not implement anything from a later phase, even if it seems convenient. Put ideas under **Backlog ideas** in `PROGRESS.md`.

### Changing the design
- `evidence-model.md` is the contract. If the existing code or a library forces a deviation, choose the smallest deviation, record it in the **Decisions & deviations log** (what, why, alternatives), and flag it in the phase report.
- Never weaken these invariants. Each one must be covered by a test in the phase that introduces it:
  - **I1** Assertions and text layers are append-only (no UPDATE of content columns, no DELETE). Corrections supersede.
  - **I2** Every assertion has a citation region, except agent `manual` (source + page) and agent `import` (legacy source).
  - **I3** Every text layer, assertion and conclusion references its agent/run.
  - **I4** Region boxes are normalised to 0–1 in unrotated page coordinates.
  - **I5** Evidence never depends on conclusions (module and foreign-key direction).
  - **I6** Nothing becomes `accepted` or `confirmed` without a user action.
  - **I7** Search and graph data can be fully rebuilt from relational tables.

### Ending a phase
1. All tasks `done` (or explicitly `deferred` with a reason).
2. Write the **Phase report** in `PROGRESS.md`: what was built, deviations, migrations added, how to verify (exact commands), known limitations, questions for the reviewer.
3. Set the phase status to `awaiting review`, update **Next action** to "Wait for review of Phase N", push the branch, and **stop**.

### General engineering rules
- Keep the existing build tool, framework and persistence style unless Phase 0 recommends otherwise and the reviewer approves.
- One migration history for the whole schema. Migrations are forward-only; never edit an applied migration.
- Secrets (API keys) only from environment variables; never in code, config files or `PROGRESS.md`.
- Tests against a real Postgres (Testcontainers) using the same image as development.

---

## 2. Phases overview

| Phase | Goal | Review focus |
| --- | --- | --- |
| 0 | Discovery: understand the existing Meridian code; no code changes | Is the mapping of existing code to the design right? |
| 1 | Foundation: modules, Postgres with extensions, migrations, test infra | Build structure and dev environment |
| 2 | Layers 1–2: sources, pages, regions, processing runs, text layers | Schema and invariants I1, I3, I4 |
| 3 | Layer 3 + places, names, dates | Evidence model, FuzzyDate, normalisation |
| 4 | Layer 4 + migration of existing Meridian data | Data integrity of the migration |
| 5 | Ingestion v1: local folder, text extraction, OCR | End-to-end on real PDFs |
| 6 | Extraction contract and review workflow | Quality of proposed assertions, review UX |
| 7 | Search | Search results on real data |
| 8 | Graph projection (Apache AGE) | Rebuild = incremental, FAN queries |
| 9 | Entity resolution | Candidate quality, review flow |
| Backlog | Transkribus, Arcanum, GEDCOM export, embeddings, gazetteer import | Prioritised by the reviewer later |

---

## Phase 0 — Discovery (no production code changes)

Goal: learn the existing codebase and propose how the design maps onto it.

| ID | Task | Acceptance |
| --- | --- | --- |
| P0.T1 | Inventory the stack: Java version, build tool, framework, persistence approach (JPA, jOOQ, JDBC…), database and version, migration tool, test setup, frontend technology, how the app is run locally. | Recorded under **Environment facts** in `PROGRESS.md`. |
| P0.T2 | Map the existing domain: the project/research-project layer, person and relationship tables and classes, other genealogy entities; row counts if a local database exists. | Table in `PROGRESS.md` mapping each existing entity to a design entity (or "no equivalent"). |
| P0.T3 | Identify conflicts with the design (e.g. database is not Postgres, no migration tool, persistence style that makes append-only hard). | Listed with a proposed resolution for each. |
| P0.T4 | Propose the concrete module layout and package names based on the actual code (target: `meridian-evidence`, `meridian-conclusions`, `meridian-ingest`, `meridian-graph`, `meridian-app`). | Proposal in `PROGRESS.md`, including what existing code moves where. |
| P0.T5 | Confirm the existing build and tests pass; record the baseline commands. | Baseline commands and result recorded. |

**Reviewer checks:** environment facts are correct; the entity mapping is right; the module proposal is acceptable.

---

## Phase 1 — Foundation

Goal: restructure into modules and prepare infrastructure, with **no behaviour change**.

| ID | Task | Acceptance |
| --- | --- | --- |
| P1.T1 | Restructure into the approved multi-module layout. Existing domain code goes into `meridian-conclusions` (or as approved in P0.T4); new modules are empty skeletons. | App starts and behaves as before; all existing tests pass. |
| P1.T2 | Enforce dependency direction with an architecture test (e.g. ArchUnit): `conclusions → evidence` allowed, never `evidence → conclusions`; `graph` and `ingest` depend on `evidence`/`conclusions`, not the reverse. | Architecture test in the build; a deliberate violation fails it. |
| P1.T3 | Development database: Postgres 16+ with extensions `age`, `vector`, `fuzzystrmatch`, `pg_trgm`, `unaccent`, via Docker Compose. If no single public image has all of them, write a Dockerfile; record image name and versions. | `docker compose up` gives a database where `CREATE EXTENSION` succeeds for all five. |
| P1.T4 | Migrations: keep the existing tool if there is one, otherwise introduce Flyway with a baseline of the current schema. Add a migration that enables the extensions. | Fresh database migrates from zero; existing local database migrates without data loss. |
| P1.T5 | Integration tests with Testcontainers using the same image. Provide a shared test base class. | A smoke test checks all extensions in the test database. |
| P1.T6 | Configuration properties: document root folder (the Drive sync folder), page-image cache folder, raw-output retention. Validate at startup that the document root exists. | Documented in the README section for the evidence layer. |

**Reviewer checks:** app still works; module boundaries; database image and versions.

---

## Phase 2 — Sources and text (Layers 1–2)

Goal: schema, domain model and repositories for Repository, Source, DigitalCopy, Page, Region, ProcessingRun, ProcessingRunItem, TextLayer.

| ID | Task | Acceptance |
| --- | --- | --- |
| P2.T1 | Migrations and entities for Repository and Source (with parent source hierarchy and call number fields). | CRUD tests; parent hierarchy test. |
| P2.T2 | DigitalCopy with content SHA-256 as unique identity; Drive file id optional. | Inserting the same hash twice is rejected or returns the existing copy. |
| P2.T3 | Page and Region, with value object `NormalizedBox` (0–1, x0<x1, y0<y1), optional polygon, nested regions. | Invariant **I4** tests: invalid boxes rejected; nesting works. |
| P2.T4 | ProcessingRun and ProcessingRunItem (per page: status, error, pages billed). Raw processor output stored durably in the database (e.g. a `processor_output` table: bytes, media type, schema version, SHA-256), referenced from the run item. | Raw output round-trips byte-for-byte. |
| P2.T5 | TextLayer: original and normalised text, language, script, confidence, optional word coordinates (JSON), `supersedes`. A view or query returning the current text layer per page/region. | Invariant **I1** (no update/delete of text content) and **I3** (run required) tests; current-layer query test. |
| P2.T6 | Service API for this layer (create source, register copy, add pages/regions, record a run with items, add a text layer) used by later phases. | Service-level tests; no controller/UI yet unless trivial. |

**Reviewer checks:** schema matches the design; invariants enforced at database level where possible (constraints, triggers) and in code.

---

## Phase 3 — Evidence, places, names, dates

| ID | Task | Acceptance |
| --- | --- | --- |
| P3.T1 | `FuzzyDate` value type (as written, earliest, latest, calendar, precision, derived from) persisted with a generated or maintained `daterange` column and a GiST index. Helper to compute a range from a stated age at an event date. | Unit tests for range computation; overlap query test. |
| P3.T2 | Place, PlaceName (validity), PlaceParent (civil/church hierarchy, validity). Query: names of a place at a date; ancestors of a place at a date. | Tests with a place that changed name and parent over time. |
| P3.T3 | NameVariant (canonical, variant, language, origin). | CRUD and lookup tests. |
| P3.T4 | Normalisation service: Romanian diacritic folding (ş→ș, ţ→ț, accent-insensitive key), plus a Daitch–Mokotoff key computed via Postgres `daitch_mokotoff()`. | Tests: "Ştefan"/"Ștefan"/"Stefan" share a key; DM keys for sample surnames. |
| P3.T5 | Record (kind, regions, event FuzzyDate, place, run) and Persona (record, name as written, role, stated age, occupation, residence, house number). | Tests. |
| P3.T6 | Assertion: subject (record or persona), property, original/normalised value, optional object persona, citation region, agent/run, confidence, status, supersedes. Status transitions `proposed → confirmed | rejected` only through a user action method. | Invariant tests **I1**, **I2**, **I3**, **I6**. |
| P3.T7 | Persona convenience view built from current confirmed assertions. | View test: superseded and rejected assertions excluded. |

**Reviewer checks:** FuzzyDate behaviour, normalisation examples, assertion workflow.

---

## Phase 4 — Conclusions and legacy migration

| ID | Task | Acceptance |
| --- | --- | --- |
| P4.T1 | Person, Family (+ family children with birth order), PersonaLink, Relationship, ConclusionEvidence, ProofNote, project source list. All project-scoped. | Tests; invariant **I5** (no FK from evidence to conclusions); **I6** for links. |
| P4.T2 | Preferred values on Person (birth, death, name) reference chosen assertions; a "best guess" query for display when nothing is pinned (not stored). | Tests with conflicting assertions. |
| P4.T3 | Migration **dry run**: a command that reads existing Meridian data and writes a report (counts per entity, fields with no target, anomalies) without writing. | Report file generated; added to the phase report. |
| P4.T4 | Migration: create a "Legacy Meridian data" Repository and Source; for each existing person create Person + import-agent Persona(s) + Assertions citing the legacy source; map relationships to Family / Relationship. Old tables are renamed (e.g. `legacy_*`), **not dropped**. | Counts match the dry-run report; migration is repeatable on a fresh copy of the data. |
| P4.T5 | Switch existing Meridian features to the new model (or compatibility views), so the app works as before. | Existing tests pass, adapted only where the model changed; manual smoke test steps written in the phase report. |

**Reviewer checks:** verify counts; spot-check 10 persons and their families in the app; approve before the legacy tables are ever dropped (dropping is a separate, later migration, only after explicit approval).

---

## Phase 5 — Ingestion v1 (local folder, text, OCR)

| ID | Task | Acceptance |
| --- | --- | --- |
| P5.T1 | Folder scanner over the configured document root: finds new or changed files (PDF, DOCX, DOC, images), computes SHA-256, registers DigitalCopy. Unknown files go to an "unassigned" inbox until the user links them to a Source. | Re-scanning creates no duplicates; moved/renamed files are recognised by hash. |
| P5.T2 | Optional sidecar metadata (`<file>.meta.json`: source title, repository, date, page label, access URL) and/or filename convention, applied on registration. Document the format. | Test with and without sidecar. |
| P5.T3 | Page splitting and rendering (e.g. PDFBox) into the disposable cache; Page rows with size and rotation. DOCX/DOC become a single text page without an image. | Cache can be deleted and regenerated. |
| P5.T4 | Router v1 (recorded as a ProcessingRun): use the embedded PDF text layer if it passes a quality check (e.g. share of plausible words); otherwise OCR. Pages of sources flagged as handwritten go to an "awaiting HTR" state instead. | Classification recorded per page item. |
| P5.T5 | Text extraction processors: Apache Tika (embedded text, DOCX/DOC) and Tesseract via Tess4J (languages configurable, default `ron`; record traineddata versions). Each produces TextLayers on a whole-page Region, with raw output stored. | Tests with small fixture files (one text PDF, one scanned PDF, one DOCX). |
| P5.T6 | A trigger to run ingestion (CLI command or admin endpoint, matching Meridian's style) and a status view of runs and failed items; re-run of a single page. | Failed item can be re-run as a one-page batch. |

**Reviewer checks:** run on 5–10 real documents (including an Arcanum export and a scanned register); inspect text quality and run records.

---

## Phase 6 — Extraction contract and review workflow

| ID | Task | Acceptance |
| --- | --- | --- |
| P6.T1 | Extraction contract v1 as a JSON Schema in resources: record, personas (role, name as written…), assertions with region references and original/normalised values. | Schema validates good fixtures and rejects bad ones. |
| P6.T2 | `Extractor` interface and a manual path (user enters a record, personas and assertions for a region). | Manual entries become `confirmed` assertions with agent `manual`. |
| P6.T3 | LLM extractor implementation behind the interface: provider, model and API key from configuration/environment; versioned prompt in resources; output validated against the contract; valid output → `proposed` assertions; invalid → failed run item with the validation error. Per-batch page limit and a dry-run mode. | Tests with a stubbed client; no real API calls in tests. |
| P6.T4 | Review service and API: list proposed assertions with their region crop, confirm, reject, correct (correction = new assertion superseding the proposal). | Invariant **I6** tests; rejected proposals are not re-proposed for the same region and property. |
| P6.T5 | Review UI in Meridian's existing frontend technology (scope agreed at the Phase 5 review). | Reviewer can process a page end to end. |

**Reviewer checks:** run extraction on a few real pages; judge proposal quality and review speed; decide prompt changes.

---

## Phase 7 — Search

| ID | Task | Acceptance |
| --- | --- | --- |
| P7.T1 | Search index table, one row per region: original and normalised text (`tsvector` with `simple` + `unaccent`), trigram index, Daitch–Mokotoff keys of persona names, daterange, place ids expanded up the hierarchy, source kind, project scope via project source list. | Full rebuild command; invariant **I7** test (rebuild from empty equals incremental). |
| P7.T2 | Incremental updates when text layers or assertions change, in the same transaction. | Tests. |
| P7.T3 | Name search expanding NameVariants and phonetic keys; fuzzy text search via trigram. | Tests: "Ioan" finds "Iohannes" (variant) and DM matches. |
| P7.T4 | Search API returning regions with a crop endpoint (render crop from cache; regenerate if missing). | Crop matches the region box on a fixture. |
| P7.T5 | Embedding column (pgvector) behind a feature flag, no provider wired. | Migration only; embeddings stay a reviewer decision. |

**Reviewer checks:** search quality on real data; speed.

---

## Phase 8 — Graph projection (Apache AGE)

| ID | Task | Acceptance |
| --- | --- | --- |
| P8.T1 | `AgeGraphAdapter`: the only class that issues Cypher and parses `agtype`. Graph creation and explicit indexes on label tables (vertex id, properties GIN; edge start/end ids). | Adapter tests; architecture test that no other class uses Cypher/`agtype`. |
| P8.T2 | Projection builder: full rebuild from relational tables (nodes and edges as in the design). | Rebuild test on fixture data. |
| P8.T3 | Incremental projection updates in the same transaction as the relational change. | Invariant **I7**: rebuild result equals incremental result. |
| P8.T4 | Queries: FAN neighbourhood of a persona or person (bounded 1–2 hops, filters by role and date range); candidate clusters over SAME_AS via JGraphT connected components. | Tests on fixtures. |
| P8.T5 | Kinship queries (ancestors, descendants, common ancestors) as recursive SQL with `CYCLE` over Family tables. | Test with an endogamous fixture (same ancestor via two lines) terminates and returns correct results. |

**Reviewer checks:** FAN results on real data make sense.

---

## Phase 9 — Entity resolution

| ID | Task | Acceptance |
| --- | --- | --- |
| P9.T1 | Blocking: candidate pairs by phonetic surname key + birth decade + parish (configurable). | Tests; pair counts reported. |
| P9.T2 | Comparators: Jaro-Winkler on normalised names (Apache Commons Text), date-range overlap, place compatibility, FAN overlap (shared parents, spouses, godparents, witnesses within 1–2 hops). | Unit tests per comparator. |
| P9.T3 | Weighted scoring with weights in configuration; each run is a ProcessingRun (processor `entity-resolution`); results are `candidate` PersonaLinks with score and per-signal breakdown. Previously rejected pairs are never re-proposed. | Invariant **I6**; rejected-pair test. |
| P9.T4 | Review queue (API + UI): accept, reject, or link to another person; accepted links can propose NameVariant pairs for the user to confirm. | End-to-end test. |
| P9.T5 | Calibration report from user decisions: acceptance rate per score band and per signal, to tune weights manually. | Report generated from fixture decisions. |

**Reviewer checks:** candidate quality on real data; weights.

---

## Backlog (not scheduled; reviewer prioritises)

- Transkribus processor for handwritten registers (PAGE XML → Region + TextLayer).
- Arcanum Newspaper Segmentation processor (rotated coordinates → normalised boxes).
- GEDCOM export from Person/Family.
- Embedding provider and semantic search.
- Place gazetteer import (GeoNames/Wikidata) and historical administrative units.
- Dropping the `legacy_*` tables after explicit approval.
