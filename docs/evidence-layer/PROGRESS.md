# Meridian Evidence Layer — Progress

The agent keeps this file up to date after every task. The reviewer approves phases here.

## Current status

- **Current phase:** 0 — Discovery
- **Phase status:** awaiting review  <!-- not started | in progress | awaiting review | approved -->
- **Next action:** Wait for review of Phase 0. Reviewer must answer Open question 1 (stack mismatch) before Phase 1 can be planned.
- **Last updated:** 2026-11-02

## Phase overview

| Phase | Status | Branch | Approved |
| --- | --- | --- | --- |
| 0 Discovery | awaiting review | ccr-adaa4345-wbnkkm (see decisions log) | |
| 1 Foundation | not started | evidence/p1 | |
| 2 Sources and text | not started | evidence/p2 | |
| 3 Evidence, places, names, dates | not started | evidence/p3 | |
| 4 Conclusions and legacy migration | not started | evidence/p4 | |
| 5 Ingestion v1 | not started | evidence/p5 | |
| 6 Extraction and review | not started | evidence/p6 | |
| 7 Search | not started | evidence/p7 | |
| 8 Graph projection | not started | evidence/p8 | |
| 9 Entity resolution | not started | evidence/p9 | |

## Task checklist

Status values: `todo`, `in progress`, `done`, `blocked`, `deferred`.

### Phase 0
| ID | Status | Files touched | Notes |
| --- | --- | --- | --- |
| P0.T1 | done | PROGRESS.md | see sections below |
| P0.T2 | done | PROGRESS.md | see sections below |
| P0.T3 | done | PROGRESS.md | see sections below |
| P0.T4 | done | PROGRESS.md | see sections below |
| P0.T5 | done | PROGRESS.md | see sections below |

### Phase 1
| ID | Status | Files touched | Notes |
| --- | --- | --- | --- |
| P1.T1 | todo | | |
| P1.T2 | todo | | |
| P1.T3 | todo | | |
| P1.T4 | todo | | |
| P1.T5 | todo | | |
| P1.T6 | todo | | |

### Phase 2
| ID | Status | Files touched | Notes |
| --- | --- | --- | --- |
| P2.T1 | todo | | |
| P2.T2 | todo | | |
| P2.T3 | todo | | |
| P2.T4 | todo | | |
| P2.T5 | todo | | |
| P2.T6 | todo | | |

### Phase 3
| ID | Status | Files touched | Notes |
| --- | --- | --- | --- |
| P3.T1 | todo | | |
| P3.T2 | todo | | |
| P3.T3 | todo | | |
| P3.T4 | todo | | |
| P3.T5 | todo | | |
| P3.T6 | todo | | |
| P3.T7 | todo | | |

### Phase 4
| ID | Status | Files touched | Notes |
| --- | --- | --- | --- |
| P4.T1 | todo | | |
| P4.T2 | todo | | |
| P4.T3 | todo | | |
| P4.T4 | todo | | |
| P4.T5 | todo | | |

### Phase 5
| ID | Status | Files touched | Notes |
| --- | --- | --- | --- |
| P5.T1 | todo | | |
| P5.T2 | todo | | |
| P5.T3 | todo | | |
| P5.T4 | todo | | |
| P5.T5 | todo | | |
| P5.T6 | todo | | |

### Phase 6
| ID | Status | Files touched | Notes |
| --- | --- | --- | --- |
| P6.T1 | todo | | |
| P6.T2 | todo | | |
| P6.T3 | todo | | |
| P6.T4 | todo | | |
| P6.T5 | todo | | |

### Phase 7
| ID | Status | Files touched | Notes |
| --- | --- | --- | --- |
| P7.T1 | todo | | |
| P7.T2 | todo | | |
| P7.T3 | todo | | |
| P7.T4 | todo | | |
| P7.T5 | todo | | |

### Phase 8
| ID | Status | Files touched | Notes |
| --- | --- | --- | --- |
| P8.T1 | todo | | |
| P8.T2 | todo | | |
| P8.T3 | todo | | |
| P8.T4 | todo | | |
| P8.T5 | todo | | |

### Phase 9
| ID | Status | Files touched | Notes |
| --- | --- | --- | --- |
| P9.T1 | todo | | |
| P9.T2 | todo | | |
| P9.T3 | todo | | |
| P9.T4 | todo | | |
| P9.T5 | todo | | |

## Environment facts
Gathered in P0.T1 (2026-11-02). **The repository is not what the plan assumes** (Java / Postgres / multi-module); see Open question 1.

| Item | Fact |
| --- | --- |
| Language / runtime | JavaScript (ES modules) + JSX. **No Java anywhere in the repo.** Node 22.23.4 / npm 10.9.9 in the dev container; CI uses Node 20 + latest npm. |
| App type | Client-only single-page app, no backend, no server code. Deployed as static files to GitHub Pages (base path `/meridian/`). |
| Framework / build | React 18.3, Vite 5, `@vitejs/plugin-react`. Scripts: `dev`, `build`, `preview`, `test`. |
| Persistence | Browser **IndexedDB** (`meridian-v1`, stores `projects` keyed by `id` — whole project as one JSON document — and `blobs` keyed by `key` for attached files). Accessed through `StorageService` -> `IndexedDBAdapter` (swappable adapter). |
| Database / migrations | No SQL database, no migration tool. IndexedDB `DB_VERSION = 1` with a single `onupgradeneeded`; project documents are upgraded lazily by `normalizeProject()`. |
| Import / export | Native share bundle `.zip` (`project.json` + `media/`) via JSZip; GEDCOM export (verified facts only) and a lossy GEDCOM import (FAMC/FAMS ignored). |
| Tests | Vitest 4 + jsdom + Testing Library + fake-indexeddb. 6 files, 76 tests, all in `src/tests/`. No Postgres/Testcontainers. |
| Frontend | The React app itself (`src/App.jsx` ~900 lines, `components/`, `hooks/useProject.js`). |
| CI/CD | One workflow, `deploy.yml`: `npm ci` + `npm run build` on push to master, then Pages deploy. Tests are **not** run in CI. |
| Docs | ADRs 0001-0004 in `docs/adr/` (export tracks, bundle JSON as source of truth, verified-only GEDCOM, verified marker UI). |
| Local data | No local database to count rows in; user data lives in each user's browser. Only `src/sampleData.js` is in the repo. |
| Run locally | `npm ci` (see baseline note), `npm run dev` (port 5173). |

### Baseline (P0.T5)
- `npm ci` with the container's npm 10.9.9 **fails** (`EUSAGE`: lockfile missing `esbuild@0.28.2`/`@esbuild/*` entries). It succeeds with the newer npm CI uses: `npx -y npm@latest ci`. This matches the earlier "Upgrade npm in CI" commit. No lockfile change was made.
- `npx vitest run` -> 6 files, **76 passed**, 0 failed.
- `npm run build` -> succeeds (`dist/assets/index-*.js` 319 kB). Only Vite deprecation warnings (esbuild/oxc option).
- Not run: any Java/Gradle/Maven/Docker commands (none apply).

## Existing entities → design mapping
Filled in during P0.T2. Existing model is one JSON document per project (`src/models/project.js`, `sampleData.js`); nothing is shared between projects.

| Existing entity / table | Design entity | Notes |
| --- | --- | --- |
| IndexedDB store `projects` (one doc per project: name, description, settings) | Project (per-project owner of Layer 4) | Design has no shared library today: every project would share one evidence library. |
| `project.people[]` (id, name, sex, birth{year,place,verified}, death{...}) | Person (Layer 4) + import-agent Persona + Assertions (birth, death, name, sex) | Only years, no day/month -> FuzzyDate precision `year`. Names are single free-text strings (no given/surname split, maiden name embedded e.g. "(b. Văleanu)"). |
| `person.fatherId`, `motherId`, `spouseIds[]` | Family (partners + children), derived | Families are not stored; GEDCOM export reconstructs them by key. Birth order and marriage data are not recorded as such (marriage appears only as an event). |
| `person.events[]` (year, label, type, note, sourceId, verified) | Assertions on the legacy Persona (type -> property) | Free-text labels; `type` is a small vocabulary. |
| `person.periods[]` (start, end, label, ...) | Assertions with a date range (occupation/office/residence) | No clean property vocabulary; label is free text. |
| `person.groups[]`, `project.annotations[]` (brackets), `project.eras[]` | No equivalent | Presentation / analysis constructs of the timeline. Stay in the app; not evidence. |
| `person.media[]` (pins to a source at a year) | No direct equivalent | Presentation pin referencing a Source. |
| `project.sources[]` (title, type, date, repository, citation APA7, url, text, blobKey, fileName, mimeType, linkedPersonIds, linkedYearRange, tags, verified) | Source + Repository (+ DigitalCopy when a blob exists) | Closest existing concept. `repository` is free text, `citation` is a string, `verified` is a boolean. No pages/regions. |
| IndexedDB store `blobs` (attached scans/PDFs/images) | DigitalCopy (content SHA-256 as identity) | Keyed by random key today, not by hash; duplicates possible. No page splitting. |
| `verified` flags on facts/events | Assertion status `confirmed` | Boolean, set by the user, so I6 can be honoured; no agent/run recorded. |
| Share bundle `.zip` / `project.json` | No equivalent (export format) | ADR 0002 makes bundle JSON the source of truth; this conflicts with the design (see conflicts). |
| Places (`birth.place` strings, event labels) | Place / PlaceName | Free text only; no place entity, coordinates or hierarchy. |
| Records, Personas, Layer 1-2 entities, TextLayer, ProcessingRun, NameVariant | No equivalent | New. |

## Conflicts between the design and the existing code (P0.T3)

| # | Conflict | Proposed resolution |
| --- | --- | --- |
| C1 | **No backend.** The plan needs Java, Postgres 16 (AGE, pgvector, fuzzystrmatch, pg_trgm, unaccent), Flyway, Testcontainers, Docker Compose, PDFBox, Tika, Tesseract. The app is a static GitHub Pages SPA with IndexedDB. | Reviewer decision required (Open question 1). Options: (A) add a new Java/Spring service + Postgres as a separate backend and keep the SPA as a client; (B) add a Node/TypeScript backend + Postgres (same language as the frontend); (C) stay client-only: keep IndexedDB and redesign the layers for the browser (no AGE/pgvector/fuzzystrmatch, no server OCR). My recommendation: A or B, because the design relies on Postgres features, server-side OCR and API keys that cannot live in a static page. C only if the product must remain serverless. |
| C2 | **GitHub Pages deployment** cannot host a server, database or secrets (rule: secrets only from env vars). | The backend needs its own hosting; the SPA keeps Pages and talks to the API (CORS/auth to design). Decide hosting in Phase 1. |
| C3 | **Persistence style.** One mutable JSON document per project makes append-only (I1), per-row agent/run (I3) and shared evidence (principle 6) impossible without a new store. | Evidence layer gets its own relational store; the project document keeps only presentation data and references (ids) into it. |
| C4 | **Migration history.** No migration tool; IndexedDB has one version; "legacy_* tables renamed, not dropped" has no analogue for browser data held by end users. | Legacy migration (P4) must run as an explicit import of an exported share bundle (`project.json`) into the backend, leaving the original bundle untouched; the in-browser data is the "legacy" copy. |
| C5 | **ADR 0002** (share-bundle JSON is the source of truth) and **ADR 0003** (GEDCOM exports only verified facts) conflict with a database being the source of truth. | Write a superseding ADR once C1 is decided; keep bundle export as a projection of the database. ADR 0003's verified-only rule maps cleanly to `confirmed` assertions. |
| C6 | **Plan assumes module names `meridian-*` and a Java test strategy.** | Re-express per the chosen option in P0.T4. |
| C7 | **CI does not run tests.** Plan requires green build and tests before each task and per-phase. | Add `npm test -- --run` to the workflow in Phase 1 (small, no behaviour change). |
| C8 | **Container npm cannot `npm ci`** the committed lockfile. | Use `npx -y npm@latest ci`; consider regenerating the lockfile in Phase 1 (needs approval since it touches `package-lock.json`). |
| C9 | **Data fidelity.** Existing facts are years, free-text names/places, no pages or regions. The invariant I2 (citation region) cannot be satisfied for legacy data. | Already covered by design: import agent cites the legacy source. Migration will mark all legacy assertions with agent `import`. |
| C10 | **Frontend-only language mismatch for unit-of-work:** plan tasks such as ArchUnit, JPA/jOOQ choice do not apply. | Replace with equivalent checks (e.g. dependency-cruiser/ESLint import rules, or ArchUnit if Java is chosen). |

## Decisions & deviations log

| Date | Phase/Task | Decision or deviation | Reason | Alternatives considered |
| --- | --- | --- | --- | --- |
| 2026-11-02 | P0 | Worked on the session-designated branch `ccr-adaa4345-wbnkkm` instead of `evidence/p0`. | The cloud session is restricted to pushing that branch. | Create `evidence/p0` (would need push permission). |

## Module layout proposal (P0.T4)
The plan's target (`meridian-evidence`, `-conclusions`, `-ingest`, `-graph`, `-app`) is Java-oriented. I cannot propose package names inside existing Java code because there is none. Proposal, contingent on the decision for C1:

**Option A/B (recommended): monorepo, SPA stays, new backend alongside.**
```
/ (repo root)
  web/ (or keep root for now)   existing React SPA (src/, index.html, vite.config.js) -> later `meridian-app` UI
  server/
    meridian-evidence/    Layers 1-3, places, names, dates, processing runs (no dependency on conclusions)
    meridian-conclusions/ Layer 4 (Person, Family, PersonaLink, ...), depends on evidence
    meridian-ingest/      folder scanner, router, Tika/Tesseract processors, extraction
    meridian-graph/       AGE adapter, projection, FAN, entity resolution
    meridian-app/         HTTP API, wiring, configuration
  db/                     docker compose + Dockerfile for Postgres with extensions
  docs/
```
- Existing code that moves: nothing in Phase 1. The SPA stays at the repo root (or moves under `web/` as a pure rename if the reviewer wants; this breaks the Pages workflow path unless updated). `src/models/project.js`, `gedcom.js`, `share.js` remain in the SPA; in Phase 4 their data is migrated server-side and the SPA gets an API-backed `StorageService` adapter (the adapter seam already exists).
- The "legacy data -> `meridian-conclusions`" step in P1.T1 does not apply; there is no server domain code to move.
- Dependency direction (I5) is enforced by module graph + architecture test as planned (ArchUnit for Java, or dependency-cruiser for TS).

**Option C (client-only):** one `src/evidence/` package inside the SPA with its own IndexedDB stores; separate folders `evidence`, `conclusions`, `ingest`, `graph`; import-rule lint for I5. Not recommended (see C1).

## Open questions for the reviewer

1. **Stack decision (blocks Phase 1).** The plan assumes Java + Postgres + Flyway + Testcontainers, but Meridian is a client-only React/Vite SPA on IndexedDB, deployed to GitHub Pages. Which option: (A) new Java backend + Postgres, (B) new Node/TypeScript backend + Postgres, or (C) client-only redesign? Recommendation: A or B (see C1). Also: where will the backend be hosted?
2. May the SPA be moved under `web/`, or should it stay at the repo root?
3. May I add `npm test` to the CI workflow and regenerate `package-lock.json` (C7, C8)?
4. Is `master` the integration branch, and may I use `evidence/pN` branches (the session currently restricts me to `ccr-adaa4345-wbnkkm`)?
5. Is there any real (non-sample) user data I should plan the P4 migration around, e.g. an exported bundle I can use for the dry run?

## Backlog ideas

<!-- Ideas noticed while working that belong to later phases or are out of scope. -->

## Phase reports

### Phase 0 report
- **Built:** No code changes. Recorded environment facts, entity mapping, conflicts, module proposal and test baseline in this file.
- **Migrations added:** none.
- **Deviations:** see log (branch name). The larger finding is the stack mismatch in C1; no design invariant was weakened.
- **How to verify:** `npx -y npm@latest ci && npx vitest run && npm run build` (expect 76 tests passing, build OK). Review "Environment facts", "Existing entities -> design mapping", "Conflicts" and "Module layout proposal".
- **Known limitations:** no local data to count rows; entity mapping is based on code and sample data only.
- **Questions for the reviewer:** Open questions 1-5, chiefly 1.

**Review**
- Approved: no
- Reviewer notes:

<!--
Template for each phase:

### Phase N report
- **Built:**
- **Migrations added:**
- **Deviations:** (link to log entries)
- **How to verify:** exact commands and manual steps
- **Known limitations:**
- **Questions for the reviewer:**

**Review**
- Approved: yes / no
- Reviewer notes:
-->

## Session log

| Date | Tasks worked on | Commits | Notes |
| --- | --- | --- | --- |
| 2026-11-02 | P0.T1-P0.T5 | see git log | Discovery only; found stack mismatch; awaiting review. |
