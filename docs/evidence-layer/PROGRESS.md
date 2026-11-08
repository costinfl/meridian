# Meridian Evidence Layer — Progress

The agent keeps this file up to date after every task. The reviewer approves phases here.

## Current status

- **Current phase:** 3 — Evidence, places, names, dates
- **Phase status:** in progress  <!-- not started | in progress | awaiting review | approved -->
- **Next action:** P3.T2 (IndexedDB v4: places, names, records, personas, assertions).
- **Last updated:** 2026-11-08 (Phase 2 approved, Phase 3 started)

## Phase overview

| Phase | Status | Branch | Approved |
| --- | --- | --- | --- |
| 0 Discovery | approved | evidence/p0 (done on `ccr-adaa4345-wbnkkm`, see log) | 2026-11-02 |
| 1 Foundation | approved | evidence/p1 (done on `ccr-adaa4345-wbnkkm`) | 2026-11-06 |
| 2 Library sources and text | approved | evidence/p2 (done on `ccr-adaa4345-wbnkkm`) | 2026-11-08 |
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
| P0.T1 | done | docs/evidence-layer/PROGRESS.md | see sections below |
| P0.T2 | done | docs/evidence-layer/PROGRESS.md | see sections below |
| P0.T3 | done | docs/evidence-layer/PROGRESS.md | see sections below |
| P0.T4 | done | docs/evidence-layer/PROGRESS.md | see sections below |
| P0.T5 | done | docs/evidence-layer/PROGRESS.md | see sections below |
| P0.T6 | done | docs/evidence-layer/PROGRESS.md | see sections below |
| P0.T7 | done | docs/evidence-layer/PROGRESS.md | see sections below |

### Phase 1
| ID | Status | Files touched | Notes |
| --- | --- | --- | --- |
| P1.T1 | done | src/{evidence,conclusions,ingest,search,graph,workers}/index.js, src/components/evidence/index.js, src/storage/upgrades/ | Empty modules only; nothing imports them yet; bundle size unchanged (319.19 kB). |
| P1.T2 | done | src/tests/archRules.js, src/tests/architecture.test.js | Rules per the Phase 0 layout (evidence -> storage only; conclusions -> evidence/models/storage; ingest -> evidence/storage; search, graph -> evidence; workers -> non-UI; storage -> nothing). Scans static, side-effect, dynamic imports and `new URL(.., import.meta.url)`. Deliberate violation (`evidence/index.js` importing `models/project.js`) failed the test with `must not import models/project.js`, then removed. The rule "only repositories may call generic store methods" is added in P2.T1 when those methods exist. |
| P1.T3 | done | .github/workflows/deploy.yml | New `test` job (Node 20, latest npm, `npm ci`, `npm test -- --run`); `build` has `needs: test`, so a failing test blocks the Pages build and deploy. Also added a `pull_request` trigger (deviation, logged): tests and build run on PRs to master; `deploy` is skipped for PRs. Verified locally by YAML parse and dependency graph; the workflow itself first runs on the PR. |
| P1.T4 | done | src/storage/upgrades/{index,v1,v2}.js, src/storage/adapters/IndexedDBAdapter.js, src/storage/StorageService.js, src/tests/upgrade.test.js | DB version 1 -> 2 (adds `settings` store only). Forward-only step list; `openDB()` runs steps; `getSetting/putSetting/deleteSetting` added. R1 handled: on `versionchange` the connection closes, the adapter drops it and calls `onVersionChange`; `onBlocked` hook too. Tests build a hand-made v1 DB with projects + blob and prove it survives (I8); fresh DB; no-op reopen; a simulated v3 step on top; versionchange closes the connection. Note: fake-indexeddb drops the Blob prototype, so blob presence + record metadata are asserted. Main bundle 319.19 -> 320.43 kB. |
| P1.T5 | done | src/evidenceFlag.js, src/components/evidence/EvidencePanel.jsx, src/App.jsx, src/hooks/useProject.js (`setEvidenceUi`), src/models/project.js (`evidenceUi: false` default), src/tests/evidenceFlag.test.jsx, src/tests/useProject.test.js | Flag = `project.settings.evidenceUi === true` or `?evidence=1`. Hidden by default (App test), shown with the URL flag (App test opens and closes the lazy panel). Panel is a separate lazy chunk (1.15 kB); main bundle 320.43 -> 322.10 kB. There is deliberately no UI toggle for the project setting yet (only the hook setter); the reviewer enables via `?evidence=1` or an imported project with the setting. |
| P1.T6 | done | src/storage/persistence.js, src/components/evidence/EvidencePanel.jsx, src/App.jsx, src/tests/persistence.test.jsx | `requestPersistence()` runs when the flag is on; panel shows persistence state, usage/quota and last bundle export time (Open question 5). `doExportZip` now also stores `lastBundleExportAt` in the `settings` store (device-local, not in bundles). All helpers degrade to `null`/"not supported". Verified in real Chromium (see Phase 1 report). The export-time write itself is covered by the browser run, not a unit test (jsdom lacks `URL.createObjectURL`). Main bundle 323.49 kB; panel chunk 1.55 kB. |

### Phase 2
| ID | Status | Files touched | Notes |
| --- | --- | --- | --- |
| P2.T1 | done | src/storage/upgrades/v3.js, src/storage/adapters/IndexedDBAdapter.js, src/storage/StorageService.js, src/tests/{upgrade,dbMethods,architecture}.test.js, src/tests/archRules.js | DB version 2 -> 3: stores evRepositories, evSources, evCopies, evPages, evRegions, evRuns, evRunItems, evRawOutputs, evTextLayers, evPageCache with indexes (copies by unique sha256 and source; pages by copy and unique [copyId,pageIndex]; regions by page/parent; text layers by region/run/supersedes; run items by run/page; sources by parent/repository). Generic `db*` methods (`dbAdd` insert-only, `dbPut`, `dbTransact` atomic multi-store). Architecture test now also enforces that only src/storage and src/evidence/repositories call `db*` (completes the rule deferred from P1.T2). v2 -> v3 upgrade test (lossless, indexes present). |
| P2.T2 | done | src/evidence/{ids.js,domain/errors.js,repositories/repositoryStore.js,repositories/sourceStore.js}, src/tests/{evidenceHelpers.js,sourceStores.test.js} | Store factories take the storage service (dependency injection). Repository kinds archive/library/online/private; LibrarySource kinds parish-register ... other; call number {fond, inventory, file}; parent hierarchy with existence and cycle checks done in one transaction; update is whitelisted (id/createdAt immutable). Place stays free text (`placeText`) until Phase 3. 8 tests incl. hierarchy and cycle rejection. |
| P2.T3 | done | src/evidence/domain/hash.js, src/evidence/repositories/copyStore.js, src/tests/copyStore.test.js | SHA-256 via crypto.subtle (realm-safe input detection: jsdom and Node ArrayBuffers differ); verified against known vectors. `register` / `registerFile` return `{copy, created}`: same hash returns the existing copy (even from another name/location; concurrent duplicates yield one row, enforced by the unique `bySha256` index). Storage modes `blob {blobKey}` and `folder {path}` (relative, no `..`). Unassigned inbox = `sourceId: null`; `relocate` for moved files; `update` is whitelisted (hash/id immutable). |
| P2.T4 | done | src/evidence/domain/box.js, src/evidence/repositories/pageStore.js, src/tests/pageStore.test.js | I4: `normalizedBox` requires finite numbers in 0-1 with x0<x1, y0<y1 (rejects NaN, strings, out of range, inverted, zero-size); optional polygon (>=3 points in 0-1); `boxFromPixels` for import-time conversion on the unrotated image. `addPage` is idempotent per (copyId, pageIndex) and creates the whole-page region in the same transaction. Regions nest (same page only), are insert-only (no update/delete: they are citation targets). Page label and rotation are editable; size/position are not. Containment of child inside parent is **not** enforced (OCR boxes can overhang); `boxContains` is available. |
| P2.T5 | done | src/evidence/repositories/runStore.js, src/tests/runStore.test.js | Processors router, pdf-text, docx-text, tesseract, llm-extraction, entity-resolution, manual, import. Run configuration fixed at `startRun`; only status/finishedAt change, via `finishRun` (once; later calls are conflicts). Items: queued/running/succeeded/failed/skipped/awaiting-htr, with error, unitsBilled, rawOutputId and a small structured `result` (router classification, P5.T4). Raw outputs (`evRawOutputs`) are insert-only; bytes stored as an ArrayBuffer copy with sha256 and size; round trip verified for all 256 byte values and UTF-8 text with diacritics. |
| P2.T6 | done | src/evidence/repositories/textLayerStore.js, src/evidence/index.js, src/tests/textLayerStore.test.js | I1: the store has no update/delete/put/set operations; `dbAdd` rejects re-inserting an id (tested), and the architecture test confines db* calls to repositories. I3: `runId` required and must exist; region must exist. Corrections use `supersedesId` (same region, target must exist, a layer can be superseded only once). `current(regionId)` = newest non-superseded layer; `currentForPage(pageId)` maps regionId -> current layer. Word boxes validated with the I4 helper. Open point: `normalizedText` defaults to the original text until the Phase 3 normaliser exists. `createEvidenceLibrary(storage)` wires all stores. |
| P2.T7 | done | src/conclusions/linkLegacySource.js, src/models/project.js (`librarySourceId: null` default), src/evidence/repositories/sourceStore.js (+`dateText`, `url`), src/tests/linkLegacySource.test.js | `linkProjectSourceToLibrary({library, loadBlob, project, sourceId})` returns a new project plus `{librarySourceId, repositoryId, copyId, copyCreated, warnings}`; the caller persists. Not called by the app yet. Free-text repository -> Repository (reused by case-insensitive name; url sources -> `online`, others `private`); type -> kind (document/image/url, else other); parseable ISO dates -> dateRange, other dates kept as `dateText`; blob -> DigitalCopy (same file on two sources is not duplicated, with a warning); text-only sources register no copy. Idempotent; input project not mutated. |

### Phase 3
| ID | Status | Files touched | Notes |
| --- | --- | --- | --- |
| P3.T1 | done | src/evidence/domain/fuzzyDate.js, src/tests/fuzzyDate.test.js | FuzzyDate plain object {asWritten, earliest, latest, earliestDay, latestDay, calendar, precision, derivedFrom}. `earliestDay/latestDay` are Julian Day Numbers, so ranges compare correctly across Julian and Gregorian records (this also gives Julian->Gregorian conversion for free: 1843-03-12 Julian = 1843-03-24 Gregorian; verified against JDN reference values and a full round trip over four years in both calendars). Constructors: stated parts (day/month/year), about (+-2 years), before/after (open ends use sentinel days), ISO text. `fromStatedAge({value, unit: years|months|days, slack})` at an event date: 45 ani at 1885-03-01 -> 1839-03-02..1840-03-01, verified by brute force against the completed-years definition; leap-day cases only widen. `overlaps`, `containsDay`, `validateFuzzyDate`. The persisted index and the Romanian text parser ("12 Martie 1843") come later (P3.T2 stores, Phase 6 extraction). |
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

Pre-filled from commit `243bf1c` by the planning session; **confirmed in P0.T1 on 2026-11-02 (commit `8bd5f41`) with the corrections listed under the table.**

| Item | Value |
| --- | --- |
| App | Client-only SPA, Vite 5, React 18, plain JavaScript (ES modules), inline styles + `src/theme.js` tokens |
| Dependencies | `react`, `react-dom`, `jszip` |
| Storage | IndexedDB `meridian-v1`, version 1, stores `projects` (keyPath `id`) and `blobs` (keyPath `key`); access via `src/storage/StorageService.js` → `adapters/IndexedDBAdapter.js` |
| Project model | `src/models/project.js` (`createProject`, `createSource`, event/period/group/annotation/era/media factories, `normalizeProject`); autosave in `src/hooks/useProject.js` |
| Interop | Native bundle `src/share.js` (ADR-0001/0002), GEDCOM 5.5.1 `src/gedcom.js` (verified-only, ADR-0003) |
| Tests | Vitest 4 + jsdom + `fake-indexeddb` + Testing Library; `src/tests/*.test.js`; script `npm test` (use `npm test -- --run` for a single pass) |
| Build / deploy | `npm run build` → `dist/`, Vite `base: "/meridian/"`; GitHub Actions deploys to Pages on push to `master` (Node **22** since the CI fix on 2026-11-06; was 20); test job added in P1.T3 |
| Lint / format | No ESLint or Prettier config in the repo at this commit |
| Docs | ADRs in `docs/adr/` (0001–0004); `README.md` is out of date (describes the single-file `App.jsx`) |

**P0.T1 confirmation and corrections**
- Confirmed as written: Vite 5.4.21, React 18.3.1, `jszip` 3.10.1, IndexedDB `meridian-v1` v1 with stores `projects` and `blobs`, Vitest 4.1.9 + jsdom 29 + fake-indexeddb 6.2.5 + Testing Library, Pages deploy with Node 20 and no test job, no ESLint/Prettier/editorconfig.
- Correction: ADRs are now 0001-0005 (0005 is **Proposed**, not yet Accepted).
- Correction: README is stale in more than one place (single-component claim at README.md:162; the swimlane, research mode and share features have since moved into `components/`, `hooks/`, `share.js`, `gedcom.js`).
- Addition: attached blobs are keyed `blob_<timestamp>_<fileName>` (`SourcesPanel.jsx:58`), not by content hash, so duplicates are possible today.
- Addition: the adapter caches one open connection (`IndexedDBAdapter._open`) and has **no** `onversionchange` / `onblocked` handling; with two tabs open, a version upgrade in one tab would be blocked until the other closes (see Risks, R1).
- Addition: the seed project (`useProject.js:26`) is built from `SAMPLE_PEOPLE`, `SAMPLE_ANNOTATIONS`, `SAMPLE_ERAS` and has an empty `sources` list.
- Addition: in the dev container `npm ci` fails with npm 10.9.9 (`EUSAGE`, lockfile lacks `esbuild@0.28.2` entries); `npx -y npm@latest ci` works, which matches what CI does (`npm install -g npm@latest`). The plan's "run `npm ci`" step therefore needs that workaround locally (see Open question 6).

## Existing model → design mapping
Confirmed and extended in P0.T2. Sample-data counts come from `SAMPLE_PEOPLE` (the seed project), measured with a script run outside the repo.

| Existing | Design | Notes |
| --- | --- | --- |
| `project.people[]` (8 in sample) | Person | Kept in place; shape unchanged. |
| `birth`, `death` (`{year, place, verified}`) | Person facts → assertions | Year only and free-text place; FuzzyDate precision `year`. 8 births, 8 deaths in sample; 1 verified of each. |
| `events[]` (14), `periods[]` (7), `groups[]` (2) with `sourceId`, `verified` | Person facts → assertions (`assertionIds`, `preferredAssertionId`) | 2 events and 1 period verified; groups none. Free-text `label` and small `type` vocabulary: the legacy property is the kind plus label. |
| Totals in sample | | **39 facts, 5 verified, 0 with a `sourceId`**, no media pins, 0 project sources. So the sample proves the "verified without source" case: those legacy assertions must cite the "Legacy Meridian data" source (I2 exception). |
| `fatherId`, `motherId`, `spouseIds` (5 with father, 4 with mother, 4 with spouses) | Family | Families are not stored today; `gedcom.js:43-56` already derives them by key (parents pair, plus spouse pairs). P4.T2 can reuse that derivation so the results are identical (I8). Nothing in the UI writes these fields (see impact list). |
| `project.sources[]` (+ blob) | Project source list → LibrarySource + DigitalCopy | Link through `librarySourceId` (P2.T7). `repository` and `citation` are free text; `verified` is a source-level flag (used by GEDCOM `SOUR` records, `gedcom.js:39`). |
| Blob store key `blob_<ts>_<name>` | DigitalCopy `storage: blob` | Hash is computed when first linked; existing keys stay valid. |
| `project.annotations` (braces), `project.eras`, `person.media` (pins) | No change | Braces may later cite assertions/ProofNotes (P6.T5 / Backlog). |
| `project.settings` | Feature flag `evidenceUi` | Added in P1.T5; `normalizeProject` does not currently touch `settings`. |
| Native bundle `project.json` + `media/` | Bundle v2 adds `evidence.json` | `share.js` imports via `normalizeProject`, so older bundles keep loading. |
| GEDCOM export/import | Unchanged | Export reads the derived `fatherId/motherId/spouseIds` and `verified`; import ignores FAMC/FAMS (`gedcom.js:184`) and creates people with `spouseIds: []` (`gedcom.js:154`). |

### Impact list for Phase 4 (P0.T3): code touching `fatherId`, `motherId`, `spouseIds`, `verified`, `sourceId`
Non-test code (line numbers at commit `8bd5f41`):

| Area | Where | Reads / writes |
| --- | --- | --- |
| Relationship inference | `src/App.jsx:63-71` | **reads** `fatherId`, `motherId`, `spouseIds` (labels father/mother/spouse/child/sibling/grandparent/grandchild) |
| Verified count for export toast | `src/App.jsx:463-467` | reads `verified` on birth, death, events, periods, groups |
| Timeline markers and tooltips | `src/App.jsx:81-97, 167, 185-190` | reads `verified` (via `verifiedTick/verifiedBorderStyle/verifiedMarker` in `theme.js`) |
| Media pin source lookup | `src/App.jsx:202` | reads `m.sourceId` |
| Item editor | `src/components/ItemModal.jsx:18, 44-45, 98, 105-111, 115, 125-145, 232, 254-256` | **reads and writes** `sourceId`, `verified`; `VERIFIABLE` = event, period, group, birth, death |
| Source panel | `src/components/SourcesPanel.jsx:36, 76, 175, 284-287` | reads and writes source-level `verified` |
| Model factories | `src/models/project.js:41, 51-77` | define `sourceId` / `verified` defaults |
| GEDCOM export | `src/gedcom.js:39, 43-56, 59-62, 71-95` | reads all of the above; family derivation is here |
| GEDCOM import | `src/gedcom.js:154, 184, 218` | writes `spouseIds: []`, ignores FAMC/FAMS, sets `sourceId` from `SOUR` records |
| Seed data | `src/sampleData.js` | defines all fields |
| Tests | `src/tests/gedcom.test.js` (37 matches), `models.test.js` (13), `share.test.js` (1) | assert on the fields above |

Not touched anywhere else: `useProject.js`, `share.js` and `StorageService`/adapter never mention these fields. **No component writes `fatherId`, `motherId` or `spouseIds`** (they come only from sample data); this makes "Family becomes the source of truth" a low-risk change: the derivation in `normalizeProject` can recreate the same values, and the only editing UI to add is new.

## Library proposals (P0.T4)
Sizes are raw (not gzipped) file sizes from the installed packages. "Spike" means I built and ran it with the repo's Vite 5.4.21 and the pre-installed Chromium 153 (scratch project outside the repo, not committed). All of these are lazy-loaded only when evidence features are used.

| Need | Proposal | Version / licence | Size | Evidence and reason |
| --- | --- | --- | --- | --- |
| PDF text, word boxes, rendering | **pdfjs-dist** | 6.5.438, Apache-2.0 | `pdf.min.mjs` 474 kB + `pdf.worker.min.mjs` 1,272 kB | Spike: in a module Worker built by Vite 5, `getTextContent` returned the Romanian text with diacritics and positions; rendering to `OffscreenCanvas` worked. pdf.js logs "Setting up fake worker" when run inside our own worker; harmless. Actively maintained (published 2026-11-01). |
| DOCX → text | **mammoth** | 1.13.0, BSD-2-Clause | ~2 MB unpacked (browser bundle size not measured) | Not exercised in the spike. Maintained (2026-09). Phase 5 task P5.T3 must measure the bundle. |
| OCR | **tesseract.js** + Romanian `ron` data | 7.0.0, Apache-2.0; `@tesseract.js-data/ron` 1.0.0, MIT | `worker.min.js` 111 kB; WASM core 2.9-4.7 MB per variant (browser picks one); `ron` best_int 1.69 MB gz | Spike (self-hosted worker, core and language data, `gzip: true`): 3-line Romanian image with ş/ă/î/ț recognised exactly, confidence 93, 0.73 s in headless Chromium. This is a clean synthetic image, **not** evidence about scanned registers; Phase 5 review decides. Works without cross-origin isolation (GitHub Pages cannot send COOP/COEP). |
| Full-text search | **MiniSearch** | 7.2.0, MIT | ~640 kB package dir (min file far smaller; not measured) | Spike: prefix + fuzzy search runs in a worker; the index can be serialised to JSON, which suits `evSearchIndex` and I7. FlexSearch is larger and has a more complex API for no needed gain. |
| Daitch-Mokotoff | **Vendor `talisman/phonetics/daitch-mokotoff.js`** (single file, MIT) with its licence header, plus our own tests | talisman 1.1.4, MIT | one small file | Reproduces published vectors in the spike: Peters → 739400/734000, Moskowitz → 645740, Jackson → 154600/454600/145460/445460, Auerbach → 097500/097400 (same set as Wikipedia). **The package itself was last published in Jan 2021**, so depend on a copy, not the package. **Finding:** it folds cedilla ş (Ştefan = Stefan = 276000) but **not** comma-below ș (Ștefan → 376000), so the Romanian folding in P3.T4 must run before the code is computed, exactly as the plan says. |
| Jaro-Winkler | **Own implementation** (~30 lines) with unit tests | n/a | negligible | Needed only in Phase 9; avoids a dependency. |
| JSON Schema validation | **Ajv** | 8.20.0, MIT | ~1 MB package dir (bundle size not measured) | Mature; note Ajv compiles validators with `new Function`, fine on Pages (no CSP header). If bundle size matters, Ajv's standalone code generation at build time is the alternative. |
| Graph | **Plain `Map`s**, own BFS and union-find | n/a | negligible | Needed algorithms are bounded BFS and connected components. graphology 0.26.0 (MIT, ~2.7 MB package dir) is not justified at this scale. |

## Browser and platform findings (P0.T5)
Tested in headless Chromium 153 (Playwright) against a Vite 5 production build served over http://localhost.

| Check | Result | Consequence |
| --- | --- | --- |
| `window.showDirectoryPicker` | present (`function`) | Folder linking is feasible in Chromium. **Not tested:** the actual picker, storing a handle in IndexedDB, and permission re-prompt across sessions (needs a headed browser and a user gesture). Phase 5 task P5.T1 keeps the file-picker / drag-and-drop fallback. |
| `navigator.storage.persist()` | resolved `false` | Expected in headless; real browsers decide by heuristics. The UI must show the actual state (P1.T6) and never assume persistence. |
| `navigator.storage.estimate()` | quota ≈ 3.2 GB here | Varies by device; show it in the status line. |
| `crossOriginIsolated` | `false` | GitHub Pages cannot set COOP/COEP, so no `SharedArrayBuffer`. tesseract.js and pdf.js worked regardless. |
| Module Web Workers in a Vite 5 build | works (`new Worker(new URL("./w.js", import.meta.url), { type: "module" })`) with pdfjs, MiniSearch and the DM code bundled inside | Use this pattern for all workers. Note: **Vite 5's default build target rejects top-level `await`** in app code (my spike failed until I wrapped it in an async function); don't use it in new modules. |
| LLM providers allow direct browser calls (CORS preflight from `https://costinfl.github.io`) | Anthropic API: preflight 200, `access-control-allow-origin: *`, allows the `anthropic-dangerous-direct-browser-access` header (calls must send it). OpenAI API: preflight 200, origin echoed. Google Generative Language API: preflight returned 403 from this sandbox, undetermined. | A preflight is not proof a real call succeeds; no key was used. Provider choice is Open question 2 and does not block Phases 1-5. |

## Folder layout proposal (P0.T6)
```
src/
  models/ storage/ hooks/ components/ share.js gedcom.js theme.js App.jsx   (existing, stay where they are)
  storage/upgrades/        one file per IndexedDB version step (v2 settings, v3 library stores, v4 evidence stores ...)
  evidence/                Layers 1-3 + places/names/dates; imports nothing outside src/evidence and src/storage
    domain/                fuzzyDate.js, normalize.js (folding, DM), box.js (normalizedBox), ids
    repositories/          one module per store group; the only code allowed to call generic store methods
    index.js
  conclusions/             families, persona links, relationships, assertion<->fact glue; may import evidence and models
  ingest/                  scanner, router, processors (pdf-text, docx-text, tesseract, llm), orchestration
  search/                  index builder/query (pure, runs in a worker)
  graph/                   projection, FAN, kinship (the only module used for graph queries)
  workers/                 thin worker entry files that import the pure modules above
  components/evidence/     evidence UI, loaded with React.lazy / dynamic import so the main bundle (319 kB today) stays unchanged until the flag is on
  tests/                   existing; new tests may sit next to modules or in src/tests/
```
Dependency rules (extend P1.T2 to check them): `evidence` → only `evidence`/`storage`; `search`, `graph`, `ingest` → `evidence` (graph may also read `conclusions` data passed in); `conclusions` → `evidence` and `models`; `components/**` and `App.jsx` may import anything; nothing under `evidence`, `search`, `graph`, `ingest`, `workers` imports UI.

Needed storage change (for P1.T4/P2.T1): `StorageService` and the adapter get generic store methods (`put`, `get`, `getAll`, `getAllByIndex`, a small `transaction`). Because a generic `put` could update evidence rows, **I1 is enforced by the repositories and by the architecture test that only `src/evidence/repositories/**` (and `src/storage/**`) may call those methods.** Components still never call IndexedDB.

Existing code stays where it is. The only moves are new files; `normalizeProject` gains evidence-aware steps in Phase 4 but remains in `src/models/project.js`.

## Baseline (P0.T7)
Run on 2026-11-02 at commit `8bd5f41` (docs-only changes since `243bf1c`), Node 22.23.4, npm 10.9.9:

| Command | Result |
| --- | --- |
| `npm ci` | **fails** with npm 10.9.9 (`EUSAGE`, lockfile out of sync). Works with `npx -y npm@latest ci`. |
| `npx vitest run` (same as `npm test -- --run`) | 6 files, **76 tests passed**, 0 failed, ~2.4 s |
| `npm run build` | succeeds; `dist/assets/index-*.js` 319.19 kB (98.57 kB gzip); only Vite deprecation warnings (esbuild/oxc options) |

## Risks found (for the reviewer)
- **R1 Multi-tab upgrades.** The adapter has no `onversionchange`/`onblocked` handling. When Phase 1 bumps the DB version, a user with an old tab open could hang the upgrade in the new tab. P1.T4 should add a handler that closes the old connection and tells the user to reload. (Plan-compatible, small.)
- **R2 I6 versus legacy migration.** P4.T4 turns every `verified` legacy fact into a **confirmed** assertion (`decidedBy: legacy-verified`) without a new click. I6 says nothing becomes confirmed without an explicit user action. I read the user's earlier "verified" tick as that action, but this is a judgment call (Open question 4).
- **R3 Blob identity.** Existing blobs are keyed by timestamp+name, so two copies of one file can exist; linking in P2.T7 must dedupe by hash and keep old keys valid.
- **R4 Storage durability.** `persist()` may be refused; the plan already covers a status line and bundle-export reminders. Evidence is more expensive to recreate than timeline data, so I suggest the Phase 1 status line also shows "last bundle export" time (not in the plan; Open question 5).
- **R5 Bundle size.** The main bundle is 319 kB. The evidence UI and libraries must be dynamic imports; the plan requires this and the layout above supports it.

## Decisions & deviations log

| Date | Phase/Task | Decision or deviation | Reason | Alternatives considered |
| --- | --- | --- | --- | --- |
| 2026-11-02 | P0 | Phase 0 work done on the session-designated branch `ccr-adaa4345-wbnkkm` (synced to master `8bd5f41`), not on `evidence/p0`; no pull request opened | The cloud session may push only to the designated branch; the system rules say not to open a PR unless asked | Create `evidence/p0` and open a PR (needs push permission and your go-ahead) |
| 2026-11-02 | P0 | Earlier Phase 0 draft (Java/Postgres assumptions) and its `tech-stack-assessment.md` discarded; superseded by the reviewed plan | Reviewer replaced the stack; started over | none |
| 2026-11-08 | P3.T1 | FuzzyDate day numbers are Julian Day Numbers (not epoch days); "about" = +-2 years (`ABOUT_SPAN_YEARS`, overridable per call); open ends use sentinel days 0 and 5373484 | The design asks for comparable indexed ranges and a calendar flag but fixes neither the day-number base nor the width of "about"; JDN makes Julian/Gregorian comparison exact and needs no extra conversion step | Epoch days in the stated calendar (not comparable across calendars); +-1 or +-5 years for "about" (adjustable by the reviewer) |
| 2026-11-06 | P1 review | Phase 1 approved. Visible `evidenceUi` toggle added as a checkbox in the Projects dialog (per project); `?evidence=1` still works as an override. `pull_request` trigger kept. | Reviewer answers; `?evidence=1` is too easy to forget | Toggle inside the Evidence panel (unreachable while the flag is off) |
| 2026-11-06 | P1 (CI fix) | CI workflow moved from Node 20 to Node 22 (both `test` and `build` jobs) | `npm install -g npm@latest` now installs npm 12, which requires Node ^22.22.2 / ^24.15 / >=26; on Node 20 the step fails with EBADENGINE. Every deploy failed from 2026-11-02 (run 9, docs-only) through the Phase 1 merge (run 13). My P1.T3 job reused the step and I did not check CI results before reporting Phase 1 done. | Pin `npm@11` on Node 20 (still fails once Node 20 reaches end of life; the earlier answer to Open question 6 was to install the latest npm) |
| 2026-11-02 | P1.T3 | Added `pull_request` trigger (branches: master) to the deploy workflow; deploy job skipped on PRs | The plan's phase PRs would otherwise merge to a live site before any test ran | Test-only separate workflow file |
| 2026-11-02 | P0 review | Reviewer decisions: ADR-0005 accepted; self-host OCR/PDF assets; legacy verified facts confirmed by one-time user step; last-export indicator in P1.T6; install latest npm instead of regenerating the lockfile; LLM provider deferred; PR from the session branch | Phase 0 review answers 1-7 | n/a |
| 2026-11-02 | Plan | Evidence layer runs client-side in the same repo (ADR-0005, Proposed); Postgres, AGE, Flyway, Testcontainers and Java modules removed from the plan | Meridian is a static app on GitHub Pages with IndexedDB storage and no backend | Java + Postgres backend (separate repo); local ingest companion (kept in Backlog) |

## Open questions for the reviewer

<!-- Numbered; mark answered ones with the answer and date. -->
1. **Answered 2026-11-02: approved; ADR-0005 is now Accepted.** Approve ADR-0005 (client-side evidence layer)? It is still `Proposed`; I did not change its status.
2. **Answered 2026-11-02: deferred.** Phase 6 task P6.T3 cannot start until decided; Phases 1-5 are not affected. Which LLM provider and model for extraction (Phase 6)? It must allow direct browser calls. Preflight results are in "Browser and platform findings"; Anthropic and OpenAI allow it, Google undetermined.
3. **Answered 2026-11-02: self-host** (copied from `node_modules` at build time, not committed). Plan P5.T3 updated. OCR and PDF assets (WASM core ≈ 3-5 MB, `ron` data 1.7 MB, pdf.js worker 1.3 MB): **self-host** with the Pages build (offline, no third party, larger deploy) or load from a CDN by default (smaller deploy, third-party dependency)? I recommend self-hosting, copied from `node_modules` at build time rather than committed.
4. **Answered 2026-11-02: one-time user step** (legacy `verified` facts start proposed; the user confirms them in one click). Plan P4.T4 updated; risk R2 resolved. Legacy `verified` facts become `confirmed` automatically in P4.T4 (risk R2). Accept, or require a one-time "confirm legacy verified facts" step by the user?
5. **Answered 2026-11-02: yes.** Plan P1.T6 updated. Add a "last bundle export" indicator to the Phase 1 status line (risk R4)?
6. **Answered 2026-11-02: install the latest npm** (like CI); do not regenerate the lockfile. Plan operating rule 4 updated. Local setup: `npm ci` fails under npm 10.9.9 because the lockfile only syncs with the newer npm that CI installs. May Phase 1 regenerate `package-lock.json` (touches a deployment-relevant file), or should the plan just say "use `npx -y npm@latest ci`"?
7. **Answered 2026-11-02: open the PR from `ccr-adaa4345-wbnkkm`.** Branch and PR: this session may push only to `ccr-adaa4345-wbnkkm`, so Phase 0 is there rather than on `evidence/p0`. The plan says to open a pull request at phase end; I have not, because no PR was explicitly requested. Should I open one (and from which branch)?

## Backlog ideas

<!-- Ideas noticed while working that belong to later phases or are out of scope. -->
- GEDCOM import ignores FAMC/FAMS, so imported people have no parents or spouses; after Phase 4 Family exists, importing families would be a natural improvement (changes ADR-0003 scope, needs approval).
- Refresh `README.md` (still describes the single-file app) when the evidence layer lands (already in Backlog of the plan).

## Phase reports

### Phase 2 report
- **Built:** the library layers 1-2 as plain-JavaScript stores on IndexedDB, with no UI: Repository, LibrarySource (parent hierarchy, call numbers), DigitalCopy (content SHA-256 identity, blob or linked-folder location, unassigned inbox), Page + Region (normalised boxes, nesting, automatic whole-page region), ProcessingRun / RunItem / RawOutput, append-only TextLayer with superseding corrections and a current-layer query, plus `linkProjectSourceToLibrary` (not run automatically). Entry point: `createEvidenceLibrary(storage)` in `src/evidence/index.js`.
- **IndexedDB version / stores added:** 2 -> **3**; added `evRepositories`, `evSources`, `evCopies`, `evPages`, `evRegions`, `evRuns`, `evRunItems`, `evRawOutputs`, `evTextLayers`, `evPageCache` (the last is created but unused until Phase 5).
- **New dependencies:** none. Main bundle 323.49 -> 326.63 kB (+3.1 kB: the `evidenceUi` checkbox, the v3 upgrade step and the generic `db*` methods; the evidence library itself is not imported by the app yet, so it adds nothing).
- **Deviations:** none from the design. Additions: `dateText` and `url` on LibrarySource (needed for P2.T7); `librarySourceId: null` default on project sources; the architecture test also enforces the repository-only rule for `db*` store methods (planned in P1.T2's note).
- **Invariants and where they are tested:** **I1** `textLayerStore` exposes no update/delete (test), `dbAdd` refuses an existing id (test, and in real Chromium), regions/raw outputs are insert-only, and the architecture test fails if code outside `src/storage` and `src/evidence/repositories` calls `db*` methods. **I3** a text layer requires an existing run (tests). **I4** `normalizedBox` rejects NaN, strings, out-of-range, inverted and zero-size boxes, polygon points and word boxes use the same checks (tests incl. 10 invalid shapes). **I8** `upgrade.test.js` proves v1 -> v3 and v2 -> v3 keep projects, blobs and settings; `createSource` only gained a null field and all GEDCOM/bundle tests are unchanged and green. **I5** unchanged and passing.
- **Tests:** 105 -> 172 (all earlier tests unchanged). `npm test -- --run` and `npm run build` pass.
- **Real-browser check (Chromium, dev server, not committed):** a hand-made v2 database upgraded to v3 (13 stores) with project and setting intact; a real binary Blob hashed once and the same bytes from another location returned the existing copy; 6 raw bytes incl. 253-255 round-tripped; a superseding text layer became current while history kept both; re-inserting an existing text layer id was rejected; linking a project source with a real stored blob created a copy; no page errors.
- **How to verify:** `npm install -g npm@latest` (or `npx -y npm@latest ci`), `npm ci`, `npm test -- --run`, `npm run build`. Read `src/evidence/` (about 700 lines) in this order: `domain/box.js`, `repositories/pageStore.js`, `repositories/textLayerStore.js`, `repositories/copyStore.js`. There is no visible change in the app (`npm run dev`: behaviour as before; browser devtools > Application > IndexedDB > `meridian-v1` shows version 3 with the new stores, empty).
- **Backup reminder:** **export a native bundle backup before merging**: the IndexedDB version goes 2 -> 3 (adds empty stores only).
- **Known limitations:** (1) I1 is enforced by repository code and the architecture test, not by the database itself; IndexedDB has no triggers, so code that bypasses the repositories at runtime (for example from devtools) can still overwrite rows. (2) `normalizedText` defaults to the original text until the Phase 3 normaliser exists. (3) A child region is not required to lie inside its parent (OCR boxes can overhang); `boxContains` exists if you want it enforced. (4) Page width/height are stored as given (pixels or points, caller's choice) and only their ratio matters for boxes. (5) `evPageCache` has no code yet. (6) Page size and position cannot be corrected, only label and display rotation.
- **Questions for the reviewer:** (a) Keep regions insert-only (so citations can never move), or allow correcting a box through a superseding region? (b) Should a child region be forced inside its parent box? (c) Is "first registration wins" for duplicate files (later metadata ignored, `relocate`/`update` explicit) the right behaviour? (d) Page indexes are 0-based; the printed folio is a separate label. OK? (e) May `linkProjectSourceToLibrary` be wired into the Sources panel in Phase 4/5, or do you want an earlier visible "Use as evidence" action?

**Review**
- Approved: yes (2026-11-08, by merging PR #7 and asking to continue)
- Reviewer notes: no answers were given to questions (a)-(e); the current behaviour is kept as the default: regions insert-only, no forced child-in-parent containment, first registration wins, 0-based page indexes, linking not yet wired to the UI. Master deploy of the merge succeeded (run 17).
- Reviewer notes:

### Phase 1 report
- **Built:** folder skeleton for the evidence layer (P1.T1); import-boundary architecture test enforcing I5 (P1.T2); CI test job that gates the Pages build, and tests/build on pull requests (P1.T3); versioned forward-only IndexedDB upgrade framework with a `settings` store and multi-tab `versionchange` handling (P1.T4); `evidenceUi` feature flag with an empty, lazy-loaded Evidence panel (P1.T5); persistence request plus a storage/last-export status line (P1.T6).
- **IndexedDB version / stores added:** version 1 -> **2**; added `settings` (keyPath `key`). `projects` and `blobs` untouched.
- **New dependencies:** none. Main bundle 319.19 -> 323.49 kB (+4.3 kB: upgrade runner, flag, persistence helpers); the Evidence panel is a separate 1.55 kB lazy chunk.
- **Deviations:** pull_request trigger added to the deploy workflow (log, P1.T3). Phase work is on `ccr-adaa4345-wbnkkm`, restarted from master after PR #4 merged (log, P0).
- **Tests:** 76 -> 104 (architecture 6, upgrade 6, flag/App 6, persistence 10, useProject 1; all existing tests unchanged and passing). `npm test -- --run` and `npm run build` pass.
- **I5 demonstration:** adding `import { createProject } from "../models/project.js"` to `src/evidence/index.js` made the architecture test fail with `evidence/index.js (evidence) must not import models/project.js (models)`; the line was removed.
- **I8:** the upgrade test builds a v1 database by hand with projects and a blob and proves they survive; GEDCOM and bundle tests are unchanged and green. Also verified in real Chromium against the production build (vite preview): a hand-made v1 database became version 2 with stores `blobs, projects, settings`, the legacy project and blob intact, no page errors.
- **How to verify:**
  1. `npm install -g npm@latest` (or `npx -y npm@latest ci`), `npm ci`, `npm test -- --run`, `npm run build`.
  2. `npm run dev`: the app looks and behaves as before; there is no Evidence button.
  3. Open `/?evidence=1` (dev URL, or `/meridian/?evidence=1` on Pages): an **Evidence** button appears after **Sources**; it opens a small preview panel whose last line reads e.g. `Persistent storage: not granted — export a bundle regularly · Using 74 kB of 3.2 GB · Last bundle export: never`.
  4. Export > Meridian project (.zip), reopen the panel: the last-export time is now shown.
  5. Open the app in two tabs at once: nothing should hang (the old tab closes its connection on a future upgrade).
- **Backup reminder:** **export a native bundle backup before merging.** This is the first phase that upgrades the IndexedDB version (1 -> 2); the upgrade only adds an empty store, but real data deserves a backup.
- **Known limitations:** there is no UI to switch the `evidenceUi` project setting on (only `?evidence=1`, or a project that already has it); the workflow changes can only be fully exercised by the pull request run on GitHub; Chromium's persistence grant is a browser heuristic, so the panel shows "not granted" in many cases; the rule that only repositories may call generic store methods arrives in P2.T1 when those methods exist.
- **Questions for the reviewer:** (a) Should the `pull_request` trigger on the deploy workflow stay? (b) Do you want a visible toggle for `evidenceUi` (for example inside the Evidence panel or project manager) or is `?evidence=1` enough until Phase 5? (c) Is the status-line wording acceptable?

**Review**
- Approved: yes (2026-11-06)
- Reviewer notes: `pull_request` trigger stays; status-line wording accepted; wants a visible toggle for `evidenceUi` (added, see log). Merge of PR #5 deployed only after the CI Node 22 fix (PR #6).

### Phase 0 report
- **Built:** nothing in `src/`. Confirmed environment facts, mapped the model (with sample-data counts), listed every read/write of `fatherId`/`motherId`/`spouseIds`/`verified`/`sourceId`, evaluated libraries with a working spike, checked browser support and LLM CORS, proposed the folder layout, recorded the baseline, and listed risks.
- **IndexedDB version / stores added:** none.
- **New dependencies:** none added to the repo. Proposed: pdfjs-dist 6.5.438, mammoth 1.13.0, tesseract.js 7.0.0 (+ `ron` data), minisearch 7.2.0, ajv 8.20.0; vendored DM file (see Library proposals).
- **Deviations:** see Decisions & deviations log (branch/PR handling; discarded earlier draft).
- **How to verify:** `npx -y npm@latest ci && npx vitest run && npm run build` (expect 76 tests passing and a successful build). Read the sections "Environment facts", "Existing model → design mapping" (with impact list), "Library proposals", "Browser and platform findings", "Folder layout proposal", "Risks found". The spike code lived in a scratch directory and is not in the repo; I can add it under `docs/` if you want to rerun it.
- **Backup reminder:** not applicable (no storage change).
- **Known limitations:** the spike used clean synthetic inputs, not real scans; folder-handle persistence, mammoth and real-key LLM calls were not tested; bundle sizes for mammoth, Ajv and MiniSearch were not measured; sample data has no sources or media pins, so the sourced-fact path is only covered by tests.
- **Questions for the reviewer:** Open questions 1-7. Also confirm "Family is the source of truth, legacy fields derived" (plan's reviewer check): the impact list shows no UI writes those fields, so the change is low-risk.

**Review**
- Approved: yes (2026-11-02)
- Reviewer notes: ADR-0005 accepted. Family is the source of truth (confirmed). Answers recorded under Open questions.

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
| 2026-11-02 | P0.T1-P0.T7 | see git log | Started over on the reviewed plan; Phase 0 complete. |
| 2026-11-02 | Phase 0 review | see git log | Approved; ADR-0005 accepted; plan updated for answers; PR opened. |
| 2026-11-02 | P1.T1-P1.T6 | see git log | Phase 1 complete, awaiting review; PR opened. |
| 2026-11-06 | CI fix | see git log | Phase 1 merge deploy failed (npm 12 vs Node 20); workflow moved to Node 22. |
| 2026-11-06 | P1 review follow-up | see git log | Phase 1 approved; evidenceUi checkbox in Projects dialog (105 tests); Phase 2 started. |
| 2026-11-06 | P2.T1-P2.T7 | see git log | Phase 2 complete (172 tests), awaiting review; PR opened. |
| 2026-11-08 | Phase 2 review | see git log | Phase 2 approved by merge; Phase 3 started. |
