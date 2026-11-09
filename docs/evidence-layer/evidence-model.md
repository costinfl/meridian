# Meridian — Evidence & Document Model (design reference)

This is the agreed target design. `IMPLEMENTATION_PLAN.md` builds it phase by phase. Do not change the model silently: any deviation goes into the Decisions & deviations log in `PROGRESS.md` and is raised at the next phase review.

## Platform

Meridian is a **client-only** React 18 / Vite 5 app, deployed as static files to GitHub Pages on every push to `master`. All data lives in the browser (IndexedDB, via `src/storage/StorageService.js`). The evidence layer follows the same model (ADR-0005):

- **Storage:** new object stores in the existing IndexedDB database (`meridian-v1`, version bumped). Binary files stay as blobs (current behaviour) or are read on demand from a local folder.
- **No backend, no SQL.** Everything Postgres would have done (constraints, triggers, `daterange`, full-text, AGE) is done in JavaScript: repository functions enforce invariants, indexes are rebuilt in memory or serialised to IndexedDB.
- **Heavy work in Web Workers:** OCR, PDF rendering, index rebuilds and entity resolution must not block the timeline UI.
- **Native bundle stays the backup and sharing format** (ADR-0001, ADR-0002): it gains an `evidence.json`. GEDCOM export stays verified-only (ADR-0003).
- **Recommended browser:** Chromium (Chrome/Edge) for the File System Access API. Other browsers fall back to file pickers and stored blobs.
- Browser storage can be evicted: the app requests `navigator.storage.persist()` and reminds the user to export a bundle regularly.

## Principles

1. **Four layers, one direction.** Sources → Text → Evidence → Conclusions. Each layer references only the layers below it, so a conclusion can always be traced to a region of a scan.
2. **Evidence is append-only.** Assertions and text layers are never edited or deleted. A correction creates a new record that supersedes the old one.
3. **Everything derived has an agent.** Each text layer, assertion and conclusion records who or what produced it (the user, an OCR engine, an LLM, an import), with version and timestamp (PROV-O pattern: entity, activity, agent).
4. **Original and normalised side by side.** Names, places and dates keep the spelling and calendar of the record next to the normalised form used for search.
5. **Uncertainty is first-class.** Confidence scores, date ranges, calendar flags and candidate links are stored, never rounded away.
6. **Evidence is a shared library, conclusions are per project.** The evidence stores are global in the browser; each Meridian project owns its conclusions. A project bundle carries the evidence it references.
7. **Indexes are projections.** Search and graph structures are rebuilt from the object stores and never hold data that exists nowhere else.

## Layer 1 — Sources and documents (library)

| Entity (store) | Represents | Key fields |
| --- | --- | --- |
| Repository (`evRepositories`) | Where an original or copy is held or accessed (archive branch, library, online database such as Arcanum) | name, kind (archive, library, online, private), location, url |
| LibrarySource (`evSources`) | The original work: parish register volume, civil register, newspaper issue, book, census | kind, title, issuing authority, place, date range, languages, script, repositoryId, call number (fond, inventory, file), parentSourceId, citation (APA7) |
| DigitalCopy (`evCopies`) | One file held of a source | sourceId, content SHA-256 (identity), mime type, file name, page count, storage (`blob` → blobKey, or `folder` → relative path in the linked folder), accessedVia (repositoryId), access URL, accessed at |
| Page (`evPages`) | One page inside a copy | copyId, page index, printed folio/page label (e.g. "f. 23v"), width, height, rotation |
| Region (`evRegions`) | A located part of a page: article, register row, cell, text block, whole page | pageId, box, optional polygon, kind, label (Title, Body, Caption…), parentRegionId |

- `parentSourceId` builds hierarchies: newspaper title → issue, register series → volume.
- **Content hash, not file name or Drive id, is the identity of a copy.** Re-adding or moving a file never duplicates it.
- **Duplicates are flagged, not silently merged.** A byte-identical file returns the existing copy, flagged `identical`. A file with the same name in the same source (or the same folder path) but different bytes may be another edition or a better scan: it is stored as its own copy, flagged `possible-version`, and a person chooses **keep both** (the new copy gets a distinguishing label) or **replace** (the new copy takes over; the old copy is kept, marked superseded, because evidence read from it still cites it). Evidence derived from a replaced copy is listed for re-review and is never rewritten.
- Regions nest (article → blocks; page → rows → cells) and **a child region must lie inside its parent's box**. Regions are never edited: a wrong box is corrected by adding a region that **supersedes** it; old citations keep pointing at the region that was actually read, and text read from the old box is not carried over to the new one. Every citation ends at a region; a "whole page" region exists for every page.
- **One coordinate convention:** boxes normalised to 0–1 in the unrotated page image. Processor-specific coordinates are converted once, on import; originals stay in the raw processor output.
- Existing `project.sources` entries (ADR-0002) stay as the project's source list; each gets a `librarySourceId` (and its blob becomes a DigitalCopy) when it is first used as evidence.

## Layer 2 — Processing and text (library)

| Entity (store) | Represents | Key fields |
| --- | --- | --- |
| ProcessingRun (`evRuns`) | One execution of a processor over a batch | processor (router, pdf-text, docx-text, tesseract, llm-extraction, entity-resolution, manual, import), processor version, model id, parameters, schema version, started/finished at, overall status |
| ProcessingRunItem (`evRunItems`) | The outcome of a run for one page | runId, pageId, status, error, units billed, rawOutputId |
| RawOutput (`evRawOutputs`) | Processor output kept verbatim | media type, schema version, SHA-256, blob |
| TextLayer (`evTextLayers`) | Text for one page or region from one run | regionId, runId, original text, normalised text, language, script, confidence, words (optional: text + box), supersedesId |

- The router is a run too: its output is the page classification (embedded text good, needs OCR, handwritten → awaiting HTR) and the processor chosen.
- Normalised text folds diacritic variants (ş/ș, ţ/ț), removes accents for matching, and (later) transliterates Cyrillic or transitional-alphabet text into modern Romanian.
- Several text layers per region is normal; the current one is the newest that is not superseded.
- One run per batch; re-running one page is a one-page batch.
- Rendered page images are a **disposable cache** (`evPageCache`), always regenerable from the copy.

## Layer 3 — Evidence (library)

| Entity (store) | Represents | Key fields |
| --- | --- | --- |
| Record (`evRecords`) | One event entry found in a source (baptism row, marriage entry, burial, census line, newspaper notice) | kind, regionIds, event date (FuzzyDate), placeId, runId |
| Persona (`evPersonas`) | A person as described in one record | recordId, name as written, role (child, father, mother, godparent, witness, groom, deceased, priest…), stated age, occupation, residence, house number |
| Assertion (`evAssertions`) | One atomic claim about a record or persona | subject (record or persona id), property, original value, normalised value, objectPersonaId (relations), citation (regionId, or sourceId + page label for manual/import), agent, runId, confidence, status, decidedBy/decidedAt, supersedesId |

- Assertions are the source of truth; persona fields are a convenience view of current confirmed assertions.
- Relations inside a record are assertions whose subject and object are both personas of that record.
- Status workflow: `proposed` → `confirmed` | `rejected`, only through an explicit user action. **A decision is its own append-only event** (one per assertion); the assertion itself is never rewritten, and readers see the effective status. Rejected assertions stay, so the same wrong extraction is not re-proposed.
- Witnesses and godparents are personas, not notes (they feed FAN analysis).
- A citation region is mandatory, except agent `manual` (source + page label) and agent `import` (source, possibly the "Legacy Meridian data" source).
- **Extraction contract:** LLM/OCR extraction returns JSON matching a versioned JSON Schema (a record, its personas, assertions with region references), validated before anything is stored; the schema version is stored on the run.

## Layer 4 — Conclusions (per project, inside the project document)

Conclusions stay in the existing project object so the timeline, GEDCOM and bundle code keep working.

| Entity | Where | Key fields |
| --- | --- | --- |
| Person | `project.people` (existing shape) | existing fields; each fact (birth, death, event, period, group) gains `assertionIds` and `preferredAssertionId` |
| Family | `project.families` (new) | partner1Id, partner2Id (either may be null), children (personId + birth order), marriage FuzzyDate and place, status, rationale |
| PersonaLink | `project.personaLinks` (new) | personId, personaId, status (candidate, accepted, rejected), score + per-signal breakdown, method (run or manual), rationale, decidedAt, supersedesId |
| Relationship | `project.relationships` (new) | personAId, personBId, type (godparent, neighbour, associate, guardian…), status, rationale |
| ConclusionEvidence | `project.conclusionEvidence` (new) | conclusion ref (fact, family, link or relationship), assertionId, stance (supports, contradicts) |
| ProofNote | `project.proofNotes` (new) | subject refs, text, createdAt |

- **`verified` keeps its ADR-0003 meaning:** a fact is verified exactly when all its active assertions are confirmed (a birth or death has a date and a place assertion). GEDCOM export logic is unchanged.
- **Family is the source of truth for parents and spouses;** `fatherId`, `motherId` and `spouseIds` become values derived from families in `normalizeProject`, so existing components keep reading them (confirmed in Phase 0 review).
- Entity-resolution output lands as `candidate` links; nothing becomes `accepted` without the user. Rejected links are kept so false matches are not re-suggested.
- **Display name:** a person is shown under the first name identified for them (the earliest-linked persona's name). The researcher can choose "Display person with this name instead" for any other linked name (for example the Hungarian spelling found in pre-1918 archives instead of the Romanian one). This is display only: nothing is merged, renamed or re-linked.
- Person facts are chosen, not merged: conflicting assertions stay visible, the preferred one is marked (with a ProofNote when it matters). A computed best guess may be displayed when nothing is pinned, but is never stored as a conclusion.
- Research braces (`project.annotations`) may cite assertions or ProofNotes in addition to sources.

## Places, names and dates (library)

| Entity (store) | Represents | Key fields |
| --- | --- | --- |
| Place (`evPlaces`) | Settlement, parish or administrative unit | kind, coordinates, GeoNames and Wikidata ids |
| PlaceName (`evPlaceNames`) | One name of a place | placeId, name, language, valid from, valid to |
| PlaceParent (`evPlaceParents`) | Position in a hierarchy at a time | childId, parentId, hierarchy (civil or church), valid from, valid to |

A place has at most one parent per hierarchy at any moment (decision, 2026-11-09): overlapping parents are rejected. Where sources disagree, the researcher picks one parent or splits the dates and records the disagreement in notes; competing parent claims are not modelled.
| NameVariant (`evNameVariants`) | A spelling/language pair a person has entered (Ioan – Ion) | canonical form, variant, language, origin (manual or learned from confirmed links) |

- NameVariant pairs are statements about spelling, **not** about identity: search expands a name by its directly paired spellings only (one hop, either direction), never transitively, and a pair never links two personas. Whether two people are the same is a PersonaLink decision.

**FuzzyDate** (plain object embedded wherever a date appears):

| Field | Example |
| --- | --- |
| asWritten | "12 Martie 1843", "45 ani" |
| earliest, latest | ISO dates `1843-03-12` / `1843-03-12`, or a computed range for a stated age |
| earliestDay, latestDay | integer day numbers, indexed in IndexedDB for range queries |
| calendar | `julian` or `gregorian` |
| precision | day, month, year, about, before, after |
| derivedFrom | `stated` or `computed` |

- The calendar is stored per record (state and church practice may differ). Existing year-only timeline values stay; the timeline reads `earliest`'s year when it needs one number.

## Search, graph and bundle

**Search index** (Web Worker, serialised to `evSearchIndex`, always rebuildable): one document per region with original and normalised text, Daitch–Mokotoff codes of persona names (JavaScript implementation verified against published test vectors), expanded name variants, date bounds, place ids expanded up the hierarchy, source kind. Fuzzy matching covers OCR noise. Project scope = the project's source list. Every hit returns its region so the UI can show the crop.

**Graph projection** (in memory, built from the stores; no graph database):

| Node | Edges |
| --- | --- |
| Persona | APPEARS_IN → Record (role); CO_OCCURS ↔ Persona (godparent of, witness at, same house) |
| Person | SAME_AS ← Persona (link status, score); RELATED ↔ Person; PARENT_OF → Person (derived from Family) |
| Family | PARTNER ← Person; CHILD ← Person |
| Record | FROM → Source; AT → Place |
| Place | WITHIN → Place (validity) |

- One module owns the projection; the rest of the app uses its query functions.
- All traversals are bounded or use a visited set, so endogamy (the same ancestor via several lines) cannot loop.
- Rebuild from scratch equals the incrementally maintained result.

**Native bundle v2** (ADR-0006, extending ADR-0001/0002): `project.json` (unchanged role), `evidence.json` (library entities referenced by the project: sources, copies, pages, regions, text layers, records, personas, assertions, places, name variants, runs), `media/` (copy blobs, optional as before). Raw outputs and page caches are optional. Importing merges library entities by id and by copy hash, never overwriting existing evidence. API keys and folder handles never enter a bundle.

## Decisions

| Topic | Decision |
| --- | --- |
| Platform | Client-only, same repo, same Pages deployment (ADR-0005). No backend. |
| Storage | IndexedDB: existing database, new object stores, forward-only version upgrades with tests that existing projects survive. |
| Existing data | Kept in place. Each existing fact gets import-agent assertions citing its `sourceId` source, or the "Legacy Meridian data" source: a birth or death gives a date assertion and a place assertion, other facts one assertion. All start proposed; a one-time user step confirms those of `verified` facts. The legacy persona is linked to its person as a candidate, accepted per person by the user. Editing a converted fact adds a user-entered assertion that supersedes the old one. |
| Documents | Chromium: link the Drive-for-desktop folder with `showDirectoryPicker()` and read files on demand (handle stored in IndexedDB; permission re-confirmed per session). Fallback: file picker / drag-and-drop into blobs. |
| Text extraction | pdf.js for embedded PDF text (with word positions) and rendering; mammoth for DOCX; legacy `.doc` unsupported (convert via Drive export to DOCX/PDF). |
| OCR | tesseract.js in a Web Worker, `ron` default (configurable), versions recorded on the run. |
| Handwritten registers | Transkribus — deferred (likely needs the local companion, see Backlog). |
| Arcanum API | Deferred. Newspaper pages arrive as exported PDFs with Arcanum's text layer. |
| LLM extraction | Called from the browser with the user's own API key, stored only on the device; provider must allow browser (CORS) calls. |
| Search | In-browser full-text index (e.g. MiniSearch) with Romanian folding, fuzzy matching and Daitch–Mokotoff codes. |
| Graph | In-memory projection (plain maps or graphology), no graph database. |
| Entity resolution | Hand-rolled in JS in a Web Worker: blocking (phonetic surname key, birth decade, parish), Jaro–Winkler, date overlap, place compatibility, FAN overlap (1–2 hops); weighted score tuned from user decisions. |
| Separate component | Not now. A local "ingest companion" in a separate repo is a backlog option only if in-browser OCR/HTR or external APIs (CORS, keys) prove impractical; it would produce bundle-format evidence for import. |
