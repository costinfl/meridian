# Meridian Evidence Layer — Progress

The agent keeps this file up to date after every task. The reviewer approves phases here.

## Current status

- **Current phase:** 5 — Ingestion v1
- **Phase status:** awaiting review  <!-- not started | in progress | awaiting review | approved -->
- **Next action:** Wait for review of Phase 5.
- **Last updated:** 2026-11-10 (Phase 5 complete)

## Phase overview

| Phase | Status | Branch | Approved |
| --- | --- | --- | --- |
| 0 Discovery | approved | evidence/p0 (done on `ccr-adaa4345-wbnkkm`, see log) | 2026-11-02 |
| 1 Foundation | approved | evidence/p1 (done on `ccr-adaa4345-wbnkkm`) | 2026-11-06 |
| 2 Library sources and text | approved | evidence/p2 (done on `ccr-adaa4345-wbnkkm`) | 2026-11-08 |
| 3 Evidence, places, names, dates | approved | evidence/p3 (done on `ccr-adaa4345-wbnkkm`) | 2026-11-09 |
| 4 Conclusions, legacy facts, bundle v2 | approved | evidence/p4 (done on `ccr-adaa4345-wbnkkm`) | 2026-11-09 |
| 5 Ingestion v1 | awaiting review | evidence/p5 | |
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
| P3.T2 | done | src/storage/upgrades/v4.js, src/storage/upgrades/index.js, src/tests/upgrade.test.js | DB version 3 -> 4: stores evPlaces, evPlaceNames, evPlaceParents, evNameVariants, evRecords, evPersonas, evAssertions. Indexes: assertions by subject / object persona / citation region / status / run / supersedes plus compound [subject,property] and [citationRegion,property] (for 'rejected proposals are not re-proposed'); personas by record, name key and a multiEntry Daitch-Mokotoff surname key; records by kind, place, run, a multiEntry region index and denormalised event earliest/latest day (for date-range queries); place names by place/name/folded key; place parents by child/parent; name variants by canonical key and variant key. Upgrade test v3 -> v4 uses the frozen earlier steps to build a v3 database with library data, then checks it is intact. The v2 -> v3 test now stops at v3 so it keeps pinning that step. |
| P3.T3 | done | src/evidence/domain/validity.js, src/evidence/repositories/placeStore.js, src/tests/placeStore.test.js | Place (kind, coordinates, GeoNames/Wikidata ids), PlaceName with validity and folded `nameKey` (find by name ignores case, accents and cedilla/comma forms), PlaceParent with `civil`/`church` hierarchy and validity. Validity bounds are partial ISO dates (open = null); `fromDay`/`toDay` cover whole periods. Queries take `when` as ISO date, FuzzyDate, day number or [from,to] (overlap semantics): `namesAt`/`nameAt` (language preference), `findByName(text, when?)`, `parentAt`, `ancestorsAt`, `childrenAt`. Rules: one parent per child, hierarchy and moment (overlap = conflict); cycles are rejected only if they would exist at an overlapping time. Tests use fixtures: a city that changed names/languages and a village that moved Prahova -> Raionul Mizil -> Buzău (from the sample timeline). Fixture history is illustrative, not researched. |
| P3.T4 | done | src/evidence/domain/normalize.js, src/evidence/domain/daitchMokotoff.js, src/tests/normalize.test.js | Done before P3.T3 (T3's place-name keys need it; see log). `normalizeText`: NFC, cedilla -> comma-below, whitespace collapsed, case kept. `searchKey`: plus accents removed, lower case, punctuation -> space; Ştefan = Ștefan = ŞTEFAN = S+combining cedilla = Stefan -> 'stefan'. `daitchMokotoff` is a dependency-free ES port of Talisman's rule table (MIT, attributed in the file header; Phase 0 proposed vendoring the file, but it is Babel-transpiled CommonJS that needs lodash, so a clean port was cleaner). Differential check against the original package on 623 names (incl. random syllable strings): 0 differences. Published vectors reproduced (Peters, Moskowitz, Jackson, Auerbach, Ohrbach); Ștefan / Ştefan / Stefan -> 276000. `dmCodesOfName` unions token codes. Cyrillic / transitional-alphabet transliteration remains Backlog. |
| P3.T5 | done | src/evidence/repositories/recordStore.js, src/evidence/repositories/nameVariantStore.js, src/evidence/index.js, src/tests/recordStore.test.js, src/tests/evidenceHelpers.js | Record (kind, >=1 citation region, event FuzzyDate with denormalised earliest/latest day, place, run required) and Persona (name as written + folded key + Daitch-Mokotoff codes of its tokens, role, structured stated age, occupation, residence, house number, optional region) created in one transaction with all references checked. Both are as-written snapshots with no update operations; claims about them are assertions (P3.T6) and the convenience view is P3.T7. Queries: personas by folded name / DM code, records by region / place / kind, `recordsOverlapping(when)` over the date index (works across Julian/Gregorian). **Addition not in the revised plan:** NameVariant store (add idempotent, `expand(name)` follows variants both ways transitively), because Phase 7 needs it and the store existed from P3.T2. Tests set `IDBKeyRange` global like browsers do. |
| P3.T6 | done | src/evidence/repositories/assertionStore.js, src/evidence/index.js, src/tests/assertionStore.test.js, src/tests/archRules.js, src/tests/architecture.test.js | Assertion = subject (record|persona) + property (known value/relation properties or `x-` extensions) + original and normalised value + optional object persona + citation + agent/run + confidence + status + supersedesId. **I1:** no update/delete/put operations; `dbAdd` refuses a re-inserted id (tested); the only mutation is the one-time status decision (`proposed` -> `confirmed`/`rejected`), which carries every content field over unchanged (tested); corrections are new assertions (same subject and property, target must exist, superseded once). **I2:** a region citation is required, except agent `manual` (source + page label) and `import` (source). **I3:** run required and must exist; `agent` is the run's processor. **I6:** `propose` can only create proposals (a smuggled `status` is ignored); `confirmAssertion`, `rejectAssertion`, `enterAsUser` are the user-action entry points (`enterAsUser` needs a manual run); a confirmed assertion can only be superseded by a user action; the architecture test fails if ingest/search/graph/workers call those methods. Dates need a FuzzyDate, `age` a structured value, relations need an object persona of the same record. `findByRegionProperty` supports 'rejected proposals are not re-proposed' (P6.T4). Decision of a status change is **not** an append-only event row (see Phase report limitations). |
| P3.T7 | done | src/evidence/repositories/personaView.js, src/evidence/index.js, src/tests/personaView.test.js | `personaView.forPersona(id)` / `forRecord(id)`: read-only, recomputed on demand. `facts` = current (not superseded) CONFIRMED assertions per property (newest wins; differing confirmed values are listed in `conflicts`, same values are not conflicts); proposed ones appear only in `pending`, rejected and superseded never. Also `relations` / `relationsIn`, `asWritten` (the raw persona fields), and `derived.birthRange` computed from the stated age (confirmed age assertion first) at the record's event date, shown only while no birth date is confirmed and never stored. Added rule (I6): a confirmed assertion can only be superseded by a user action, so an automated proposal cannot hide a confirmed fact from the view. |

### Phase 4
| ID | Status | Files touched | Notes |
| --- | --- | --- | --- |
| P4.T1 | done | src/models/project.js, src/models/families.js (types), src/tests/families.test.js, src/tests/models.test.js | Project gains `families`, `personaLinks`, `relationships`, `conclusionEvidence`, `proofNotes` (createProject creates them; normalizeProject adds missing ones). Every fact (birth, death, events, periods, groups) gains `assertionIds: []` and `preferredAssertionId: null`; existing values are kept; people without birth/death objects are left alone. Normalising is idempotent (second call returns the same object). One existing test was reworded: 'preserves existing ids' used to assert the person object was untouched, but facts now legitimately gain the evidence fields, so it asserts ids are kept and a second normalise is a no-op. |
| P4.T2 | done | src/models/families.js, src/models/project.js, src/tests/families.test.js | `partner1Id` is the fatherId slot and `partner2Id` the motherId slot (same convention as GEDCOM HUSB/WIFE). First upgrade (no `families`): built from fatherId/motherId/spouseIds in GEDCOM order, one family per couple (couples of unknown sex listing each other become one family, where the GEDCOM export would have written two). Afterwards `normalizeProject` derives fatherId/motherId/spouseIds from families: only changed values are replaced, null/undefined preserved, a spouse array with the same members keeps its order, so an untouched project is returned unchanged. **I8 verified:** derived fields of the sample equal the originals, and GEDCOM export of the sample is byte-identical before/after (also for a legacy project upgraded on load). Family functions `setParents`, `addPartners`, `removePartners` are the way to edit relations (pure functions on the project). No UI writes these fields today (Phase 0 finding), so no component changed. Limitation: direct edits of fatherId/motherId on a project that already has families are overwritten on the next load. |
| P4.T3 | done | src/conclusions/legacyFacts.js (`dryRunLegacyConversion`, `formatDryRun`), src/components/evidence/EvidencePanel.jsx, src/tests/legacyFacts.test.js, src/tests/legacyPanel.test.jsx | Pure and read-only (test: the project JSON is unchanged). Reports per fact type: total / already converted / to convert / with and without source / verified / unverified; what would be created (records, personas, links, assertions by kind, sources to link, the anchor); verified facts to confirm; fields with no evidence target (media pins, braces, eras); anomalies (dangling source id, verified without a source, event without a year, period backwards, nameless person). Shown in the Evidence panel before the convert button. **Report for the seeded sample project:** 8 people; birth 8, death 8, event 14, period 7, group 2 = 39 facts, none with a source, 5 verified (1 birth, 1 death, 2 events, 1 period); would create 8 records, 8 personas, 8 links, 55 assertions (8 names, 8 sex, 39 facts) and the 'Legacy Meridian data' source; 5 anomalies (all 'verified without a source'). |
| P4.T4 | done | src/conclusions/legacyFacts.js (`convertLegacyFacts`, `confirmLegacyVerified`, `countLegacyVerifiedPending`), src/conclusions/personaLinks.js, src/conclusions/conclusions.js, src/conclusions/linkLegacySource.js, src/models/project.js (`legacyEvidence`), src/evidence/repositories/recordStore.js (+role `subject`), src/components/evidence/EvidencePanel.jsx, src/hooks/useProject.js (`updateProject`), tests | User action (button in the Evidence panel). Creates the 'Legacy Meridian data' source with a **snapshot of the legacy data as a real DigitalCopy** (JSON, blob store, whole-page region), one import run per conversion, and per person a record + persona (role `subject`) + an accepted PersonaLink (method `legacy-import`, decided by `legacy-import`) + assertions for name and sex. **Each timeline fact becomes ONE assertion** with extension properties `x-legacy.birth/death/event/period/group` and a structured value (not split into date/place; Phase 6 extraction can attach finer assertions). Cited to the fact's own source (linked to the library via P2.T7 on demand) or to the legacy source (dangling source ids fall back with an anomaly). All start `proposed`; the sample test proves no assertion is confirmed by conversion. Second step `confirmLegacyVerified` (panel button showing the count) confirms verified facts' assertions with decidedBy `legacy-verified`. Counts equal the dry run (tested); idempotent (second run returns the same project, writes nothing, not even a run); later additions convert incrementally; a failure leaves the project unchanged. PersonaLinks: `addLink` makes only candidates, `decideLink` (user action) adds a superseding link; the architecture test now also blocks automated modules from `decideLink`, `convertLegacyFacts`, `confirmLegacyVerified`, `setFactVerified`. Limitation: a run that fails midway leaves unlinked legacy records in the shared library. Window: between conversion and the confirm step, verified facts have proposed assertions (the flag on the fact is what the timeline uses). |
| P4.T5 | done | src/conclusions/legacyFacts.js (`setFactVerified`), src/App.jsx (`syncFactVerified` in `saveItem`, loaded lazily), tests | For a converted fact, toggling Verified in the item editor is applied through assertion decisions: verify -> confirm the preferred assertion (re-propose first if it was rejected); un-verify -> add a new PROPOSED copy as the preferred assertion (the confirmed one stays in assertionIds as history); idempotent; unconverted facts keep the plain flag. Verified in the real UI (Playwright against the dev server): convert, confirm 5, un-verify the focus person's birth -> flag false, 2 assertionIds, preferred proposed, first confirmed, GEDCOM export loses only that birth. GEDCOM of the sample project is byte-identical before and after conversion (unit test). Code is lazy-loaded (separate chunk). **Known limitation:** editing the CONTENT of a converted fact (year, label, place...) does not create a new assertion; the assertion keeps the original reading (Open question 9). |
| P4.T6 | done | src/share.js, src/evidence/repositories/evidenceBundle.js, src/conclusions/evidenceSeeds.js, src/evidence/index.js, src/App.jsx (import summary), src/tests/bundleV2.test.js | Bundle v2: `evidence.json` = the closure of what the project references (seed sources with their copies, copies, personas, assertions; then records, regions, pages, text layers, runs, places, superseded chains, all assertions of included personas/records, decisions), written only when the project references evidence, so evidence-free projects export exactly as before. Raw outputs, page cache and the whole `settings` store are never included (I9, tested with a planted API key, folder handle, cached image and raw output). Files of blob-mode copies (incl. the legacy snapshot) travel in `media/`. Import merges in ONE transaction (all or nothing, tested with an unstorable row): never overwrites; matches entities by id and copies by content hash, remapping pages and regions onto the existing copy and fixing the project's `legacyEvidence` ids; an existing assertion keeps its own state and decision; place edges that would overlap are skipped with a warning; unknown/malformed evidence.json is rejected before any write; bundles without evidence.json and storages without a library still import. Re-import adds nothing. Round trip into a fresh library compares every row of every store equal. **Bug found and fixed by the tests:** `importProjectBundle` spread `createProject()`'s empty `families: []` under an old bundle, which normalizeProject would have taken as 'no relations' and wiped parents/spouses; now unset when the bundle has none (test: old bundle keeps its families). New `importProjectBundle` returns { project, evidence }; `importProjectZip` still returns the project. App shows 'Evidence: N entries added, M already in your library'. Verified in real Chromium: convert, export from the UI, wipe the database, import the file: 55 assertions, 8 personas, 5 decisions, the legacy copy and its file restored. No ADR written (your call, see Phase report). |
| P4.T7 | done | src/conclusions/displayName.js, src/conclusions/personaLinks.js (`decideLink` clears a choice whose link is rejected), src/models/project.js (`displayName`), src/App.jsx and src/components/SourcesPanel.jsx (7 places now show `displayName(person)`), src/tests/displayName.test.js | Default = name of the earliest ACCEPTED persona link (decision order, not proposal order); candidates never count; fallback is the person's own name. `chooseDisplayName` (user action) stores `person.displayNameChoice = {personaId, name, chosenAt}` and only accepts a persona accepted as that person; `resetDisplayName` goes back; rejecting the link a choice rests on clears the choice. Display only: `person.name` (what GEDCOM exports), links and families are untouched (tested, incl. GEDCOM output identical with a choice set). The choice survives reload and bundle export/import. The Sfătu / Szvet example is the test fixture. `personaNameMap` reads names from the library (confirmed name fact, else name as written). **No selection UI yet:** after Phase 4 every person has exactly one linked persona (the legacy one), so there is nothing to choose; the picker belongs with the review/linking UI (Phase 6 and 9). |

### Phase 5
| ID | Status | Files touched | Notes |
| --- | --- | --- | --- |
| P5.T1 | done | src/ingest/folder.js, src/ingest/scanner.js (`importFiles`), src/tests/scanner.test.js, src/tests/ingestHelpers.js | `linkFolder` (showDirectoryPicker, read-only) stores `{handle, name, linkedAt}` in the device-local `settings` store only (I9); `folderPermission(handle, {request})` re-asks only from a user click; `walkFolder` (stable order, hidden entries skipped), `readFolderFile`. Fallback `importFiles`: picked or dropped files are stored as blobs (key `doc_<hash16>_<name>`) and registered as blob-mode copies; the same file found later in the linked folder is the same copy. Unit tests use an in-memory directory handle (fake-indexeddb cannot store handles); the real picker cannot be automated, so handle persistence is checked in Chromium with an OPFS directory handle (see Phase report). |
| P5.T2 | done | src/ingest/scanner.js, src/ingest/fileTypes.js, src/ingest/sidecar.js, src/evidence/repositories/copyStore.js (+`pageLabelHint`), src/tests/scanner.test.js, src/tests/fixtures/ | `scanEntries`: PDF, DOCX, JPG/PNG/TIFF by extension; hashes each file and registers a folder-mode copy; no sidecar -> Inbox (`sourceId: null`). Re-scan adds nothing; a moved or renamed file is recognised by hash and relocated; the same content at two paths is one copy (reported); a same-name file with different content is flagged for keep-both / replace; files that disappeared are reported as `missing`, never deleted; `.doc` and other types are skipped with a reason. **Sidecar format** `<file name>.meta.json`: optional `sourceTitle`, `repository`, `date`, `pageLabel`, `accessUrl`, `kind`, `handwritten` (documented in `src/ingest/sidecar.js`); it links the copy to a LibrarySource matched by title + repository (created once), also for a copy already waiting in the inbox; bad JSON or unknown fields are warnings. Progress callback and AbortSignal (a cancelled scan reports no `missing`). New dependencies installed for this phase: pdfjs-dist 6.5.438, mammoth 1.13.0, tesseract.js 7.0.0, @tesseract.js-data/ron 1.0.0. |
| P5.T3 | done | src/ingest/documents.js, src/ingest/engines.browser.js, src/evidence/repositories/pageCacheStore.js, src/evidence/index.js, src/storage/adapters/IndexedDBAdapter.js (`delete` op inside dbTransact), src/tests/documents.test.js, src/tests/nodeEngines.js | `openDocument` gives one interface over PDF (pdf.js), DOCX (mammoth -> one text page, nominal A4, no image) and images (one page whose image is the file): `pageCount`, `pageInfo` (unrotated size + rotation), `pageText` (text + word boxes, null if none), `pageImage`. Heavy libraries are injected as `engines` so the module is testable: real-file tests run pdf.js (legacy build) and mammoth under Node. `pdfItemsToWords` converts pdf.js text runs (PDF user space, bottom-left origin) to words with normalised top-left boxes on the unrotated page (I4), splitting a run between its words by length (approximate word boxes). `ensurePages` creates Page rows + whole-page regions idempotently and applies the sidecar page label to page 0. `loadCopyBytes` reads from the linked folder or blob store and **refuses a file whose hash no longer matches** the registered copy. Page cache (`evPageCache`, bytes not Blobs): render on demand, cache, clear all or per page, regenerate (tested). Browser engines load lazily; pdf.js parses in its own worker; PDF pages are rendered unrotated to JPEG. `.doc` is refused with advice; TIFF is accepted by the scanner but Chromium cannot decode it, so it fails with a 'convert' message (limitation). |
| P5.T4 | done | src/ingest/pipeline.js, src/ingest/quality.js, src/ingest/versions.js, src/evidence/repositories/runStore.js (`listItems` in creation order), src/tests/pipeline.test.js | Router run per copy, one item per page with the classification in `result`: `embedded-text` (PDF text passes the quality check: at least 20 characters and 60% of tokens look like words or numbers, configurable and recorded on the run), `docx-text`, `needs-ocr`, `handwritten` (source `script` = handwritten, set by a sidecar; item status `awaiting-htr`, no OCR) or `already-has-text` (skipped unless forced). A quality-failed PDF page goes to OCR. Then one run per text processor. Tested with the real PDF/DOCX fixtures. |
| P5.T5 | done | src/ingest/pipeline.js, src/ingest/ocrEngine.browser.js, vite.config.js (`ocrAssets`), src/tests/pipeline.test.js, src/tests/ocrEngine.test.js | Text layers go on the page's whole-page region with the raw output stored (`pdf-text-1`, `docx-text-1`, `tesseract-words-1`), `normalizedText` from the Phase 3 normaliser, OCR word boxes converted from image pixels to 0-1 (degenerate boxes dropped, text kept), confidence 0-1. Versions on runs (pdf.js, mammoth, tesseract.js, ron traineddata; a test checks them against package.json). A failed page fails only its item (run `partial`/`failed`); cancel stops between pages (`cancelled`); continuing later reads only what is missing. **OCR assets self-hosted** under `dist/ocr/` (worker, three LSTM WASM cores, ron data: 13.5 MB), copied from node_modules at build time, served from node_modules in dev, never committed; nothing is fetched from a CDN. **Bug found in real Chromium and worked around:** tesseract.js 7 never settles `createWorker` when its language data cannot be loaded (offline), so reading hung forever; the wrapper now uses tesseract's `errorHandler` plus load/page timeouts, fails fast for 30 s after a load failure, and `reset()` lets each user click retry. Real OCR is not run in automated tests (tesseract.js does not load under Node 22); the wrapper is tested with a fake module, the engine was run in Chromium (see Phase report). |
| P5.T6 | done | src/components/evidence/DocumentsSection.jsx, src/components/evidence/EvidencePanel.jsx, src/tests/documentsSection.test.jsx | Documents section in the Evidence panel (behind the flag): Link documents folder / Scan folder / Unlink (Chromium), Add files… and drag-and-drop (all browsers), one-line scan summary, document list with pages read, Inbox with Set source, Keep both / Replace old for flagged files, Read / Read again / Read N unread, a progress line with Cancel, the most recent processing runs with failed pages and **Re-run page** (a one-page batch), page-image cache size and Clear cache. The list refreshes before the message is shown. Heavy libraries load on the first Read. Component tests with stubbed engines; the whole flow was also run in real Chromium (see Phase report). |

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
| Dependencies (Phase 5) | `pdfjs-dist` 6.5.438, `mammoth` 1.13.0, `tesseract.js` 7.0.0, `@tesseract.js-data/ron` 1.0.0; loaded lazily; OCR assets self-hosted in `dist/ocr/` |
| Docs | ADRs in `docs/adr/` (0001–0006); `README.md` rewritten and `docs/user-guide.md`, `docs/development.md`, `docs/architecture.md` added on 2026-11-09 |

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
| 2026-11-10 | P5 | No Meridian Web Worker (`src/workers/` stays empty): pdf.js parses in its own worker and tesseract.js recognises in its own worker, so the timeline stays responsive without one | The plan asks for heavy work in workers; the libraries already provide them | A Meridian worker hosting the pipeline (more code, IndexedDB access from two threads) |
| 2026-11-10 | P5 | "Handwritten" is a property of the LibrarySource (`script: "handwritten"`, set by a sidecar's `handwritten: true`); such pages get router status `awaiting-htr` and no OCR | The plan says "sources flagged handwritten" without saying where the flag lives | A per-copy or per-page flag |
| 2026-11-10 | P5 | tesseract.js 7 bug worked around: `createWorker` never settles when the language data cannot load. The wrapper listens to its `errorHandler`, adds load and page timeouts, fails fast for 30 s after a load failure, and resets on every user click | Found in real Chromium: reading hung forever with the language data unreachable (offline) | Waiting for an upstream fix |
| 2026-11-09 | P4 review answers | (a) legacy PersonaLinks stay candidates, accepted per person; (b) editing a converted fact creates a superseding user-entered assertion; (c) ADR-0006 for bundle v2; (d) births and deaths split into date and place assertions now; (e) panel wording accepted | Reviewer answers | (a) accepted by the Convert click; (d) one assertion per fact |
| 2026-11-09 | P2/P3 review answers | Reviewer decisions applied as review follow-ups on PR #8 (IndexedDB v5): (P2a) a region's box is corrected by a superseding region; (P2b) a child region must lie inside its parent's box; (P2c) duplicate files are flagged, with keep-both / replace; (P2d) 0-based page indexes kept; (P2e) linking wired into the Sources panel in Phase 4/5; (P3a) "about" = +-2 years kept; (P3b) assertion decisions are separate append-only events; (P3d) assertion property list kept for the Phase 6 contract; (P3e) NameVariant expansion is one hop, never transitive, and never decides identity; display name = first name identified, user override (new task P4.T7); (P3c) one parent per place/hierarchy/moment kept until the reviewer decides | Reviewer answers | See each answer below |
| 2026-11-09 | P2c / P3c | Reviewer confirmed: "replace" means the new copy takes over and the old copy is kept, marked superseded (no in-place overwrite). Place hierarchy keeps one parent per child, hierarchy and moment (option A); competing parent claims are not planned | Reviewer answers; the app is already getting complex | Destructive overwrite; option B (competing parents with a preferred one) |
| 2026-11-09 | P2c | "Replace" does not overwrite bytes in place: the new copy supersedes the old one, which is kept (marked superseded) and its evidence is listed for re-review (`staleEvidenceFor`) | Overwriting would silently change what existing evidence cites; the reviewer's concern was exactly evidence resting on a poorer reading | Destructive overwrite of the old copy; automatic migration of evidence to the new copy |
| 2026-11-08 | P3.T3/T4 | Task order swapped: P3.T4 (normalisation, Daitch-Mokotoff) done before P3.T3 (places). Daitch-Mokotoff is a clean ES port of Talisman's rules instead of a vendored copy of its file | Place and name keys in T3 use the normaliser; Talisman's file is transpiled CommonJS depending on lodash | Do T3 without name keys and revisit it; vendor the transpiled file |
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
8. **Answered 2026-11-09: option A, keep the hard rule.** A place has at most one parent per hierarchy (civil or church) at any moment; overlapping parents are rejected. When sources disagree, the researcher chooses one parent or splits the dates and notes the disagreement. Competing parent claims (option B) are not planned; revisit only if real data demands it. (Question: may a place have more than one parent in the same hierarchy at the same time?)
9. **Answered 2026-11-09: yes.** Editing a converted fact's content creates a user-entered assertion that supersedes the preferred one (`applyFactEdit`, `supersedeAsUser`).

## Backlog ideas

<!-- Ideas noticed while working that belong to later phases or are out of scope. -->
- GEDCOM import ignores FAMC/FAMS, so imported people have no parents or spouses; after Phase 4 Family exists, importing families would be a natural improvement (changes ADR-0003 scope, needs approval).
- Refresh `README.md` (still describes the single-file app) when the evidence layer lands (already in Backlog of the plan).

## Phase reports

### Phase 5 report
- **Built:** document ingestion in the Evidence panel's new **Documents** section (behind the flag):
  - *P5.T1* link a documents folder (Chromium; the handle is kept in the device-local `settings` store only, never exported) or add/drop files (any browser; stored as blobs);
  - *P5.T2* scanner: content-hash identity (re-scan adds nothing, moved/renamed files are relocated), Inbox for documents without a source, optional `<file>.meta.json` sidecar (format in the user guide and `src/ingest/sidecar.js`), same-name/different-content files flagged for keep both / replace, missing files reported but never deleted, `.doc` refused with advice;
  - *P5.T3* one reader over PDF / DOCX / images, Page rows with unrotated size and rotation, the disposable page-image cache, and a hash check that refuses a file changed since its scan;
  - *P5.T4* a **router run** per document classifies every page (`embedded-text`, `docx-text`, `needs-ocr`, `handwritten` → `awaiting-htr`, `already-has-text`) using a configurable text-quality check;
  - *P5.T5* `pdf-text`, `docx-text` and `tesseract` runs write text layers on the whole-page region with raw output, normalised text, word boxes in 0–1 (I4), confidence and versions; self-hosted OCR assets;
  - *P5.T6* the status view: documents with pages read, Read / Read again / Read N unread, progress with Cancel, recent runs with failed pages and **Re-run page** (one-page batch), cache size and Clear cache.
- **IndexedDB version / stores added:** none (still 5). `evPageCache` from v3 is used for the first time.
- **New dependencies:** `pdfjs-dist` 6.5.438 (Apache-2.0), `mammoth` 1.13.0 (BSD-2), `tesseract.js` 7.0.0 (Apache-2.0), `@tesseract.js-data/ron` 1.0.0 (MIT). Main bundle unchanged (334 kB). Loaded only on first use: pdf.js 501 kB + its worker 1,272 kB, mammoth 305 kB, the panel 34 kB. **Deploy size grows by about 13.5 MB** for `dist/ocr/` (tesseract worker 111 kB, three WebAssembly cores of 3.9 MB each, of which the browser downloads one, and `ron` data 1.7 MB): a user who OCRs downloads about 5.7 MB once.
- **Deviations:** see the log: no Meridian worker (the libraries bring their own); "handwritten" lives on the source; tesseract.js load-failure workaround.
- **Invariants:** I1/I3 text layers append-only with a run (re-reading adds a new layer, the old one stays; tested). I4 PDF word boxes and OCR boxes converted to 0–1 on the unrotated page, degenerate OCR boxes dropped (tested). I5 `src/ingest` imports only `evidence`/`storage` (architecture test). I6 ingestion only records what it read; the architecture test blocks it from any user-decision function. I8 no schema change; all earlier tests unchanged. I9 the folder handle lives only in `settings`; bundles are unchanged.
- **Tests:** 330 -> **380**. New: scanner (16), documents with the real pdf.js and mammoth on fixture files (9), pipeline (13), OCR wrapper (6), Documents section component (6). `npm test -- --run` and `npm run build` pass.
- **Real-browser checks (headless Chromium 153, dev server, real libraries; scripts not committed):**
  - Add four files through the panel and read them: the text PDF via `pdf-text` (2 pages, word boxes), the DOCX via `docx-text`, the PNG and the scanned PDF via real tesseract OCR. The PNG came out word-perfect apart from "Ioan" read as "loan" and "ani" as "an" (confidence 0.94); the scanned PDF read "nascut" for "născut". Versions and model recorded on the runs.
  - Same-name file with different content flagged → **Keep both**; **Set source** on an Inbox document.
  - OCR language data blocked (simulating offline): 3 pages failed in under 3 s with a clear error, each offered **Re-run page**; after unblocking, **Re-run page** read the page (about 1.4 s including loading the engine). Before the fix this hung forever.
  - Folder path with a real directory handle (an OPFS folder used directly): scan registered the new image, recognised a PDF already added (same bytes) and linked it to its sidecar's source, skipped `.doc`; a moved file was relocated on re-scan; OCR of the folder file read "Elena Băltăceanu, născută la Buzău / în anul 1856…" in 0.3 s; a file changed after scanning was refused.
  - **Clear cache** removed the cached images; no requests left the site while reading (the only other host was Google Fonts, used by the app since before this phase). No page errors.
  - **Not verifiable here:** remembering a linked folder across a reload. In this sandbox's headless Chromium, reading any stored folder handle back from IndexedDB crashes the browser, even in a scratch database the app never uses. Storing handles in IndexedDB is the documented Chrome way to remember a folder; please check it in a normal Chrome window (step 2 below).
  - Speed: OCR took 0.3–1.4 s per page on these small clean images; real register scans will be slower (larger, noisier).
- **How to verify:** `npm install -g npm@latest` (or `npx -y npm@latest ci`), `npm ci`, `npm test -- --run`, `npm run build` (check `dist/ocr/` has 5 files), then `npm run dev` and open `http://localhost:5173/meridian/?evidence=1` in **Chrome or Edge**, click **Evidence**:
  1. **Add files…** with 5–10 real documents, including an **Arcanum PDF export** and a **scanned register page**, plus one DOCX. Click **Read N unread**. Note seconds per page and judge the text quality: open devtools → Application → IndexedDB → `meridian-v1` → `evTextLayers`.
  2. **Link documents folder**, choose a folder with a few documents, **Scan folder**. Reload the page, click **Evidence** again: the folder name should still be shown; **Scan folder** may ask for permission again. Move or rename a file and scan again: the summary should say "moved", not "new".
  3. Put a sidecar next to one file (example in the user guide), scan, and check the document now shows "Source: …".
  4. Disconnect from the network, read an image: the page should fail quickly with an error; reconnect and use **Re-run page**.
- **Backup reminder:** no database or project-format change in this phase; a bundle backup is still good practice.
- **Known limitations:** (1) PDF word boxes are approximate: a text run's box is split between its words by length. (2) Only Romanian OCR data is shipped; other languages need their data added to the build. (3) TIFF is registered but Chromium cannot decode it ("convert" message). (4) OCR is not tested with the real engine in CI (tesseract.js does not load under Node). (5) Remembering the folder across sessions could not be checked here (see above). (6) The text is stored but not yet used anywhere; extraction is Phase 6. (7) The Inbox's **Set source** only creates or matches a source by title; editing the source's details needs the later review UI. (8) Very large PDFs are read page by page in one batch; there is no per-document page limit yet. (9) The deploy grows by 13.5 MB of OCR assets.
- **Questions for the reviewer:** (a) After trying real documents (step 1): is in-browser OCR quality and speed good enough, or should the **local ingest companion** (Backlog) be planned? (b) Is "handwritten" as a property of the source (set by sidecar) the right place, or do you want to mark individual documents or pages? (c) Is the text-quality threshold (60% plausible words) right for Arcanum exports, or do some of them get sent to OCR unnecessarily? The router run records the score per page, so you can see it. (d) Is the extra 13.5 MB deploy size acceptable, or should only one WebAssembly core (about 3.9 MB) be shipped, at the cost of slower OCR on some machines?

**Review**
- Approved: no
- Reviewer notes:

### Phase 4 report
- **Built:**
  - *P4.T1/T2 Conclusions in the project document:* `families`, `personaLinks`, `relationships`, `conclusionEvidence`, `proofNotes`, `legacyEvidence`; every fact gains `assertionIds` / `preferredAssertionId`; **families are the source of truth** for parents and spouses (`fatherId`/`motherId`/`spouseIds` are derived on load, built from the legacy fields on first upgrade). `setParents`, `addPartners`, `removePartners` are the way to edit relations.
  - *P4.T3 Dry run, P4.T4 conversion:* every timeline fact becomes one proposed import assertion cited to its source or to "Legacy Meridian data" (a real snapshot copy of the legacy data), on an import persona linked to its person; a second deliberate step confirms the verified ones. Both steps are buttons in the Evidence panel (behind the flag).
  - *P4.T5:* toggling **Verified** in the item editor for a converted fact goes through assertion decisions.
  - *P4.T6 Bundle v2:* `evidence.json` (closure of what the project references), merged on import in one transaction by id and by content hash, never overwriting.
  - *P4.T7 Display name:* first identified name by default, user choice stored per person, shown everywhere a name appears; `person.name` and GEDCOM untouched.
- **IndexedDB version / stores added:** none (still **5**). Phase 4 changes the project document, not the database schema.
- **New dependencies:** none. Main bundle 328.39 -> **333.83 kB** (+5.4 kB: family model, normalisation, display-name helper, small App changes). The evidence library and conversion code load only when needed (separate chunks: panel 4.5 kB, library 51 kB, legacy-facts 13 kB).
- **Dry-run report for the seeded sample project (P4.T3):**
```
Legacy facts: 8 people
  birth: 8 (to convert 8, already 0; with source 0, without 8; verified 1, unverified 7)
  death: 8 (to convert 8, already 0; with source 0, without 8; verified 1, unverified 7)
  event: 14 (to convert 14, already 0; with source 0, without 14; verified 2, unverified 12)
  period: 7 (to convert 7, already 0; with source 0, without 7; verified 1, unverified 6)
  group: 2 (to convert 2, already 0; with source 0, without 2; verified 0, unverified 2)
Would create: 8 records, 8 personas, 8 candidate links, 71 assertions (8 names, 8 sex, 55 for facts; a birth or death gives a date and a place assertion), link 0 sources, the 'Legacy Meridian data' source
Verified facts to confirm in the second step: 5
Anomalies: 5
```
  Counts match the real conversion (tested) and the real UI run: 71 assertions, 8 personas, 8 candidate links, 5 verified facts (7 assertions) confirmed in the second step.
- **Deviations / decisions to flag:** (1) one assertion per fact with extension properties `x-legacy.birth|death|event|period|group` and a structured value, rather than splitting into date/place assertions; (2) the legacy PersonaLinks are created **accepted** with method and decider `legacy-import`, by the click on "Convert": I read that click as the user action (the persona is created from the person, so the link is true by construction); (3) the "Legacy Meridian data" source holds a snapshot of the legacy data as a real DigitalCopy so legacy assertions cite actual bytes; (4) no ADR was written for bundle v2 (plan: only if you want it).
- **Invariants and where tested:** **I8** GEDCOM export of the sample is byte-identical before and after normalisation and after conversion (unit tests), derived parent/spouse fields equal the originals, bundle round trip compares every library row, old bundles import. **I6** nothing is confirmed by conversion (tested); `decideLink`, `convertLegacyFacts`, `confirmLegacyVerified` and `setFactVerified` are blocked for automated modules by the architecture test; `addLink` can only create candidates. **I9** a planted API key, folder handle, cached image and raw output do not appear in any bundle file. **I2/I3** unchanged (legacy assertions are import-agent: cite a source, reference an import run). **I1/I5** unchanged and passing.
- **Tests:** 266 -> **330** after the review follow-up (321 before it; earlier tests unchanged except one reworded: "preserves existing ids" now asserts idempotence because facts legitimately gain evidence fields). `npm test -- --run` and `npm run build` pass.
- **Real-browser checks (Chromium, dev server, not committed):** convert in the Evidence panel -> confirm 5 -> un-verify the focus person's birth in the editor: flag false, preferred assertion proposed, previous confirmed kept, GEDCOM loses only that birth; export the bundle from the UI, wipe the database, import: 55 assertions, 8 personas, 5 decisions, legacy copy and file restored, families intact; a chosen display name replaces the old one in the lane header and the person list; no page errors.
- **How to verify:** `npm install -g npm@latest` (or `npx -y npm@latest ci`), `npm ci`, `npm test -- --run`, `npm run build`, then `npm run dev`:
  1. Export **GEDCOM** (Export > GEDCOM) and save it as `before.ged`.
  2. Open the app with `?evidence=1` (or tick "Evidence layer (preview)" in Projects), click **Evidence**: read the report, click **Convert ... items to evidence**, then **Confirm 5 verified facts**.
  3. Export GEDCOM again as `after.ged` and run `diff before.ged after.ged`: the diff must be empty (the export has no date or other run-specific line).
  4. Open a verified item in research mode, un-tick Verified, Save: GEDCOM export no longer contains it; re-tick it: it comes back.
  5. Export **Meridian project (.zip)**, delete the site data in the browser, reload, **Import** the zip: the toast reports the evidence entries added, and the Evidence panel shows "Nothing left to convert" (the facts arrived already converted).
  6. Spot-check people and families: compare the lanes and the "Add a relative" list with before; the `relationship` labels (father, spouse, grandparent...) must be unchanged.
- **Backup reminder:** **export a native bundle backup before merging.** Projects are upgraded in memory on load (new fields, families built) and saved in the new shape at the next edit; an older build opening such a project ignores the new fields, but edits made there to `fatherId`/`motherId`/`spouseIds` would be overwritten by the families on the next load in the new build.
- **Known limitations:** (1) ~~editing the content of a converted fact does not create a new assertion~~ - fixed in the review follow-up. (2) Between "Convert" and "Confirm verified facts" the timeline still shows the facts as verified while their assertions are proposed. (3) A conversion that fails midway leaves unlinked legacy records in the shared library; the project is unchanged and a retry starts clean. (4) The display-name picker has no UI yet: every person has one linked persona until Phase 6/9, so there is nothing to choose; the functions and the display are done and tested. (5) The bundle closure reads the whole library into memory (fine at personal scale). (6) Family edits have no UI (there was none for relations before). (7) Direct edits of `fatherId`/`motherId`/`spouseIds` in a project that already has families are reverted on load. (8) `relationships`, `conclusionEvidence` and `proofNotes` have constructors and tests but no UI yet.
- **Review follow-up (2026-11-09, same PR):** the reviewer answered the five questions; all are applied and tested:
  - *(a) Legacy links stay candidates.* Conversion only calls `addLink`; the Evidence panel lists the waiting people with an **Accept link** button each (`decideLink`, user action). Deviation 2 above no longer applies.
  - *(b) Editing a converted fact creates a superseding assertion.* `applyFactEdit` (called from the item editor's Save): each changed part gets a new assertion entered by the user (agent `manual`, citing the same source with page label "timeline") that supersedes the old one; an added part gets a new assertion; then the verified rule is applied (a verified fact's new value is confirmed by the same save). New store method `supersedeAsUser` is the only way to replace a confirmed assertion with a proposed one; it and `applyFactEdit` are blocked for automated modules by the architecture test. Open question 9 is closed.
  - *(c) ADR written:* [ADR-0006](../adr/0006-native-bundle-carries-evidence.md), extending ADR-0002.
  - *(d) Births and deaths are split now:* `birth.date` / `death.date` (year-precision FuzzyDate) and `birth.place` / `death.place`. Events, roles and groups keep one `x-legacy.*` assertion. `preferredAssertionId` is the date; "verified" now means every active assertion of the fact is confirmed. Deviation 1 above now applies only to events, roles and groups.
  - *(e) Panel wording:* accepted as is (the convert text now also mentions the date/place split).
  - Verified in real Chromium: 71 assertions and 8 candidate links after Convert; accepting one link leaves 7; editing a verified birth year 1850 -> 1851 in the editor leaves the fact verified with an active confirmed `birth.date` "1851" (agent manual) and the untouched confirmed `birth.place`; no page errors.
  - Remaining limitations: a part that is REMOVED from a fact (for example a place cleared) keeps its old assertion, since evidence is never deleted; changing a fact's source in the editor does not re-cite existing assertions; names and sex remain `x-legacy.name` / `x-legacy.sex`.
- **Questions for the reviewer:** *(all answered 2026-11-09, see Review follow-up)* (a) stay candidates; (b) yes; (c) yes; (d) split now; (e) yes.

**Review**
- Approved: yes (2026-11-09, PR #9 merged)
- Reviewer notes:

### Phase 3 report
- **Built (no UI):** `FuzzyDate` (Julian-day-number ranges, calendar flag, stated-age ranges, overlap); Romanian normalisation and Daitch-Mokotoff codes; places with names and civil/church parents valid over time; Records and Personas; NameVariants; append-only Assertions with user-action-only decisions; the persona convenience view. All reachable through `createEvidenceLibrary(storage)`.
- **IndexedDB version / stores added:** 3 -> **5** (4 in the original Phase 3 work, 5 added by the review follow-up). v4 added `evPlaces`, `evPlaceNames`, `evPlaceParents`, `evNameVariants`, `evRecords`, `evPersonas`, `evAssertions` with the indexes listed under P3.T2. v5 adds `evAssertionDecisions` (unique per assertion) and the `bySupersedes` index on `evRegions`, and moves any decision an earlier build wrote onto an assertion row into an event (tested).
- **New dependencies:** none. Main bundle 326.63 -> 328.39 kB (+1.8 kB: the v4 and v5 upgrade steps; nothing in the app imports the library yet, so the library code itself adds nothing).
- **Deviations:** (1) task order T3/T4 swapped (log); (2) Daitch-Mokotoff is a clean port of Talisman's rules, not a vendored file (log); (3) NameVariant store added although the revised plan has no task for it (needed by Phase 7); (4) FuzzyDate day numbers are Julian Day Numbers and "about" is +-2 years (log; the design left both open).
- **Invariants and where they are tested:** **I1** assertions have no update/delete/put operations, the only mutation is the one-time status decision which carries all content fields over unchanged, `dbAdd` refuses re-inserting an id (unit tests and real Chromium), corrections supersede (same subject and property, once). **I2** region citation required except manual (source + page label) and import (source). **I3** run required and must exist, `agent` is the run's processor. **I6** `propose` can only create proposals (a smuggled `status` is ignored); `confirmAssertion` / `rejectAssertion` / `enterAsUser` are the only decision entry points, a confirmed assertion can only be superseded by a user action, and the architecture test fails if ingest/search/graph/workers call them. **I4** word boxes and regions reuse `normalizedBox`. **I5** unchanged and passing. **I8** upgrade test v3 -> v4 (frozen earlier steps) and all earlier upgrade tests.
- **Tests:** 172 -> 266 (all earlier tests unchanged except those the review decisions deliberately changed: NameVariant transitivity and the v3/v4 upgrade tests, which now stop at their own version). `npm test -- --run` and `npm run build` pass.
- **Examples from the plan, as tests:** "45 ani" at 1885-03-01 -> born 1839-03-02..1840-03-01 (also brute-forced against the completed-years definition); "Ştefan" / "Ștefan" / "Stefan" share the key `stefan` and the Daitch-Mokotoff code 276000; a village that moved Prahova -> Raionul Mizil -> Buzău answers `ancestorsAt` differently in 1930, 1955 and 1970; a city with different names per language and period answers `nameAt` per date and language.
- **Real-browser check (Chromium, dev server, not committed):** a genuine v3 database (built with the frozen steps) upgraded to v4 with its data intact (20 stores); Daitch-Mokotoff codes identical for the three spellings; a Julian-dated record is found by its Gregorian date; place lookup ignores accents; persona facts appear only after `confirmAssertion`, a user correction supersedes, an automated proposal cannot supersede a confirmed assertion, re-inserting an assertion id is rejected; no page errors.
- **How to verify:** `npm install -g npm@latest` (or `npx -y npm@latest ci`), `npm ci`, `npm test -- --run`, `npm run build`. Suggested reading order in `src/evidence/`: `domain/fuzzyDate.js`, `domain/normalize.js`, `repositories/assertionStore.js`, `repositories/personaView.js`. No visible change in the app; devtools > Application > IndexedDB > `meridian-v1` shows version 4 with the new (empty) stores.
- **Backup reminder:** **export a native bundle backup before merging** (IndexedDB 3 -> 5; adds empty stores and two indexes; one data-moving step that only touches assertions written by an unmerged build).
- **Known limitations:** (0) place hierarchy allows exactly one parent per child, hierarchy and moment by decision; sources that disagree cannot both be stored as parents. (1) as in Phase 2, I1 is enforced by repository code and the architecture test, not by the database. (2) ~~A decision overwrote the status fields on the assertion row~~ - fixed by the review follow-up: a decision is now its own event and the stored assertion is never rewritten. (3) "About" width (+-2 years) and the `x-` extension properties are my choices. (4) `FuzzyDate` has no Romanian text parser yet ("12 Martie 1843"); callers pass structured parts or ISO text (the extractor will do the parsing in Phase 6). (5) Place hierarchy allows one parent per child, hierarchy and moment; real sources may disagree and would need competing claims later. (6) Records and personas are as-written snapshots with no update; corrections go through assertions. (7) Only cedilla/comma-below and diacritics are folded; Cyrillic and transitional-alphabet transliteration is Backlog.
- **Review follow-up (2026-11-09, same PR):** the reviewer answered the Phase 2 and Phase 3 questions; all code-affecting answers are implemented and tested:
  - *Regions (P2 a, b):* `correctRegion` adds a superseding region (same page and parent; once per region; not for whole-page regions); `currentRegion`, `regionHistory`, `listCurrentRegions`; `childRegions` also finds children recorded against earlier versions. A child region must lie inside its parent's box (checked on add and on correction). Text and citations on the old region stay on it; the new box must be re-read.
  - *Duplicates (P2 c):* byte-identical file -> existing copy returned, flagged `identical`. Same name in the same source (or same folder path) with different bytes -> stored as its own copy, flagged `possible-version`, `duplicateResolution: pending`. `resolveDuplicate(copyId, "keep-both"|"replace")`: keep-both labels the new copy; replace makes the new copy current and keeps the old one marked `supersededByCopyId`. `staleEvidenceFor(copyId)` lists pages, regions, text layers, records and assertions read from a copy so they can be re-reviewed. "Replace" does **not** overwrite bytes in place; the reviewer confirmed this reading on 2026-11-09 (see log).
  - *Decisions as events (P3 b):* `evAssertionDecisions`, one event per assertion (unique index); the assertion row is never touched; readers return the effective status; `getStored` and `decisionsFor` expose the raw row and the audit trail.
  - *Name variants (P3 e):* expansion is one hop (either direction), never transitive, and never decides identity. Display name (first name identified + user override) is a Phase 4 task, P4.T7.
  - *Kept as is:* "about" = +-2 years (P3 a); property list for the Phase 6 contract (P3 d); 0-based pages (P2 d); one parent per place/hierarchy/moment pending examples (P3 c, see below).
- **Decided in the follow-up:** (c) one parent per place, hierarchy and moment stays a hard rule (option A, 2026-11-09; Open question 8). Disagreeing sources are handled by choosing one parent or splitting dates, not by storing competing parents.
- **Questions for the reviewer:** *(all answered 2026-11-09, see Review follow-up)* (a) "about" = +-2 years: yes. (b) decisions as events: yes. (c) one parent per place/hierarchy/moment: keep the hard rule (option A). (d) property list: yes. (e) name variants: no transitive assumptions; display name via user choice.

**Review**
- Approved: yes (2026-11-09, PR #8 merged)
- Reviewer notes: answers to the Phase 3 questions received 2026-11-09 and applied (see Review follow-up).

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
- Reviewer notes (answers given 2026-11-09): (a) allow correcting a box through a superseding region; (b) yes, a child region must lie inside its parent box; (c) duplicates must be flagged (another edition or a better scan is possible; evidence may rest on a poorer reading), with the classic keep-both (rename) / replace choice; (d) 0-based page indexes OK; (e) wire `linkProjectSourceToLibrary` into the Sources panel in Phase 4/5. (a)-(c) were implemented as review follow-ups (see Phase 3 report, "Review follow-up"). Master deploy of the merge succeeded (run 17).
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
| 2026-11-08 | P3.T1-P3.T7 | see git log | Phase 3 complete (246 tests), awaiting review; PR opened. |
| 2026-11-10 | P5.T1-P5.T6 | see git log | Phase 5 complete (380 tests), awaiting review; PR opened. |
| 2026-11-09 | P4 review follow-up | see git log | Reviewer answers a-e applied (330 tests): candidate links + per-person accept, applyFactEdit, date/place split, ADR-0006. |
| 2026-11-09 | Documentation | see git log | At the reviewer's request: README rewritten; user guide, development guide, architecture and docs index added (describe the app as of Phase 4). No code changes. |
| 2026-11-09 | P4.T1-P4.T7 | see git log | Phase 4 complete (321 tests), awaiting review; PR opened. |
| 2026-11-09 | Review follow-up | see git log | P2/P3 reviewer answers applied: region corrections + containment, duplicate flagging, decision events, one-hop name variants (266 tests, IndexedDB v5); replace reading and place-hierarchy rule confirmed. |
