# Meridian Evidence Layer — Progress

The agent keeps this file up to date after every task. The reviewer approves phases here.

## Current status

- **Current phase:** 0 — Discovery
- **Phase status:** not started  <!-- not started | in progress | awaiting review | approved -->
- **Next action:** Start P0.T1 (confirm environment facts below).
- **Last updated:** 2026-11-02 (plan revised for the client-only stack, see Decisions log)

## Phase overview

| Phase | Status | Branch | Approved |
| --- | --- | --- | --- |
| 0 Discovery | not started | evidence/p0 | |
| 1 Foundation | not started | evidence/p1 | |
| 2 Library sources and text | not started | evidence/p2 | |
| 3 Evidence, places, names, dates | not started | evidence/p3 | |
| 4 Conclusions, legacy facts, bundle v2 | not started | evidence/p4 | |
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
| P0.T1 | todo | | |
| P0.T2 | todo | | |
| P0.T3 | todo | | |
| P0.T4 | todo | | |
| P0.T5 | todo | | |
| P0.T6 | todo | | |
| P0.T7 | todo | | |

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
| P2.T7 | todo | | |

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
| P4.T6 | todo | | |

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

Pre-filled from commit `243bf1c` by the planning session; P0.T1 confirms or corrects them.

| Item | Value |
| --- | --- |
| App | Client-only SPA, Vite 5, React 18, plain JavaScript (ES modules), inline styles + `src/theme.js` tokens |
| Dependencies | `react`, `react-dom`, `jszip` |
| Storage | IndexedDB `meridian-v1`, version 1, stores `projects` (keyPath `id`) and `blobs` (keyPath `key`); access via `src/storage/StorageService.js` → `adapters/IndexedDBAdapter.js` |
| Project model | `src/models/project.js` (`createProject`, `createSource`, event/period/group/annotation/era/media factories, `normalizeProject`); autosave in `src/hooks/useProject.js` |
| Interop | Native bundle `src/share.js` (ADR-0001/0002), GEDCOM 5.5.1 `src/gedcom.js` (verified-only, ADR-0003) |
| Tests | Vitest 4 + jsdom + `fake-indexeddb` + Testing Library; `src/tests/*.test.js`; script `npm test` (use `npm test -- --run` for a single pass) |
| Build / deploy | `npm run build` → `dist/`, Vite `base: "/meridian/"`; GitHub Actions deploys to Pages on push to `master` (Node 20); no test job in CI yet |
| Lint / format | No ESLint or Prettier config in the repo at this commit |
| Docs | ADRs in `docs/adr/` (0001–0004); `README.md` is out of date (describes the single-file `App.jsx`) |

## Existing model → design mapping
<!-- Filled in during P0.T2. Starting point from the planning session: -->

| Existing | Design | Notes |
| --- | --- | --- |
| `project.people[]` | Person | Kept in place |
| `birth`, `death`, `events`, `periods`, `groups` (each with `sourceId`, `verified`) | Person facts → assertions | `verified` ⇔ preferred assertion confirmed |
| `fatherId`, `motherId`, `spouseIds` | Family | Family becomes source of truth; fields derived (to confirm at Phase 0 review) |
| `project.sources[]` (+ blob) | Project source list → LibrarySource + DigitalCopy | Linked via `librarySourceId` |
| `project.annotations` (braces), `eras`, `media` | No change | Braces may later cite assertions / ProofNotes |

## Decisions & deviations log

| Date | Phase/Task | Decision or deviation | Reason | Alternatives considered |
| --- | --- | --- | --- | --- |
| 2026-11-02 | Plan | Evidence layer runs client-side in the same repo (ADR-0005, Proposed); Postgres, AGE, Flyway, Testcontainers and Java modules removed from the plan | Meridian is a static app on GitHub Pages with IndexedDB storage and no backend | Java + Postgres backend (separate repo); local ingest companion (kept in Backlog) |

## Open questions for the reviewer

<!-- Numbered; mark answered ones with the answer and date. -->
1. Approve ADR-0005 (client-side evidence layer)?
2. Which LLM provider and model for extraction (Phase 6)? It must allow direct browser calls.

## Backlog ideas

<!-- Ideas noticed while working that belong to later phases or are out of scope. -->

## Phase reports

<!--
Template for each phase:

### Phase N report
- **Built:**
- **IndexedDB version / stores added:**
- **New dependencies:** name, version, size
- **Deviations:** (link to log entries)
- **How to verify:** exact commands and manual steps
- **Backup reminder:** export a native bundle before merging (if storage changed)
- **Known limitations:**
- **Questions for the reviewer:**

**Review**
- Approved: yes / no
- Reviewer notes:
-->

## Session log

| Date | Tasks worked on | Commits | Notes |
| --- | --- | --- | --- |
