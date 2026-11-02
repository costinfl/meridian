# Meridian — Evidence & Document Model (design reference)

This is the agreed target design. The implementation plan (`IMPLEMENTATION_PLAN.md`) builds it phase by phase. Do not change the model silently: any deviation goes into the Decisions log in `PROGRESS.md` and is raised at the next phase review.

## Principles

1. **Four layers, one direction.** Sources → Text → Evidence → Conclusions. Each layer references only the layers below it, so a conclusion can always be traced to a pixel region of a scan.
2. **Evidence is append-only.** Assertions and text layers are never edited or deleted. A correction creates a new record that supersedes the old one.
3. **Everything derived has an agent.** Each text layer, assertion and conclusion records who or what produced it (the user, an OCR engine, an LLM, an import), with version and timestamp (PROV-O pattern: entity, activity, agent).
4. **Original and normalised side by side.** Names, places and dates keep the spelling and calendar of the record next to the normalised form used for search.
5. **Uncertainty is first-class.** Confidence scores, date ranges, calendar flags and candidate links are stored, never rounded away.
6. **Sources are shared, conclusions are per project.** Evidence is one shared library; each Meridian research project owns its own conclusions.
7. **Indexes are projections.** Full-text, vector and graph indexes are rebuilt from the relational tables and never hold data that exists nowhere else.

## Layer 1 — Sources and documents

| Entity | Represents | Key fields |
| --- | --- | --- |
| Repository | Where an original or copy is held or accessed (archive branch, library, online database such as Arcanum) | name, kind (archive, library, online, private), location, url |
| Source | The original work: parish register volume, civil register, newspaper issue, book, census | kind, title, issuing authority, place, date range, languages, script, repository, call number (fond, inventory, file), parent source |
| DigitalCopy | One file held of a source | Drive file id, content SHA-256, mime type, page count, accessed via (repository), access URL, accessed at |
| Page | One page image inside a copy | copy, page index in file, printed folio/page label (e.g. "f. 23v"), width, height, rotation, image hash |
| Region | A located part of a page: article, register row, cell, text block | page, bounding box, optional polygon, kind, label (Title, Body, Caption…), parent region |

- Parent source builds hierarchies: newspaper title → issue, register series → volume.
- **Content hash, not Drive id, is the identity of a copy.**
- Regions nest (article → blocks; page → rows → cells). Every citation ends at a region.
- **One coordinate convention:** boxes normalised to 0–1 in the unrotated page image. Processor-specific coordinates are converted once, on import; originals stay in the raw processor output.

## Layer 2 — Processing and text

| Entity | Represents | Key fields |
| --- | --- | --- |
| ProcessingRun | One execution of a processor over a batch of pages or regions | processor (router, Tika, Tesseract, HTR, Arcanum, LLM extraction, entity resolution, manual, import), processor version, model id, parameters, started/finished at, overall status |
| ProcessingRunItem | The outcome of one run for one page | run, page, status, error, pages billed, raw output reference |
| TextLayer | Text for one page or region from one run | region or page, run, original text, normalised text, language, script, confidence, word coordinates (optional, ALTO-style), supersedes |

- The router is a run too: its output is the page classification (printed newspaper, printed book, handwritten, tabular register) and the processor chosen.
- Raw processor output is kept verbatim with its schema version; parsed records can always be rebuilt from it.
- Normalised text folds diacritic variants (ş/ș, ţ/ț) and transliterates Cyrillic or transitional-alphabet text into modern Romanian.
- Several text layers per region is normal; the current one is the newest not superseded.
- One run per batch; re-running one page is a one-page batch.

## Layer 3 — Evidence

| Entity | Represents | Key fields |
| --- | --- | --- |
| Record | One event entry found in a source (baptism row, marriage entry, burial, census line, newspaper notice) | kind, regions, event date (FuzzyDate), place, produced by run |
| Persona | A person as described in one record | record, name as written, role in record (child, father, mother, godparent, witness, groom, deceased, priest…), stated age, occupation, residence, house number |
| Assertion | One atomic claim about a record or persona | subject, property, original value, normalised value, object persona (for relations), citation region, agent and run, confidence, status, supersedes |

- Assertions are the source of truth; persona columns are a view of current confirmed assertions.
- Relations inside a record are assertions whose subject and object are both personas of that record.
- Status workflow: `proposed` → `confirmed` | `rejected`. Rejected assertions stay, so the same wrong extraction is not re-proposed.
- Witnesses and godparents are personas, not notes (they feed FAN analysis).
- A citation region is mandatory, except manual notes (cite source + page) and the legacy import (cites the legacy source).
- **Extraction contract:** LLM/OCR extraction returns a versioned JSON schema (a record, its personas, assertions with region references), validated before insertion; the schema version is stored on the run.

## Layer 4 — Conclusions (per project)

| Entity | Represents | Key fields |
| --- | --- | --- |
| Person | A real individual, as concluded within one project | project, preferred name, preferred birth and death (chosen from linked assertions), notes |
| Family | A couple and their children (GEDCOM FAM unit) | project, partner 1, partner 2 (either may be unknown), children with birth order, marriage date and place, status, rationale |
| PersonaLink | The decision that a persona is this person | person, persona, status (candidate, accepted, rejected), score, method (entity-resolution run or manual), rationale, decided by, decided at, supersedes |
| Relationship | Other concluded ties between two persons | person A, person B, type (godparent, neighbour, associate, guardian…), status, rationale |
| ConclusionEvidence | Assertions supporting or contradicting a conclusion | conclusion (link, family or relationship), assertion, stance (supports, contradicts) |
| ProofNote | Written reasoning where evidence conflicts | project, subject conclusions, text, created at |

- Entity-resolution output lands as `candidate` links; nothing becomes `accepted` without the user.
- Person facts are chosen, not merged: conflicting assertions stay visible, the preferred one is marked (with a ProofNote when it matters). A computed best guess may be displayed when nothing is pinned, but is never stored as a conclusion.
- Rejected links are kept so false matches are not re-suggested.
- Parents and spouses go through Family; other ties through Relationship.

## Places, names and dates

| Entity | Represents | Key fields |
| --- | --- | --- |
| Place | Settlement, parish or administrative unit | kind, coordinates, GeoNames and Wikidata ids |
| PlaceName | One name of a place | place, name, language, valid from, valid to |
| PlaceParent | Position in a hierarchy at a time | child, parent, hierarchy (civil or church), valid from, valid to |
| NameVariant | Spellings/language forms of a given name or surname | canonical form, variant, language, origin (manual or learned from confirmed links) |

**FuzzyDate** (value type, embedded wherever a date appears):

| Field | Example |
| --- | --- |
| as written | "12 Martie 1843", "45 ani" |
| earliest, latest | 1843-03-12 / 1843-03-12, or a computed range for a stated age |
| calendar | Julian or Gregorian |
| precision | day, month, year, about, before, after |
| derived from | stated or computed |
| indexed range | Postgres `daterange(earliest, latest)` with a GiST index |

- The calendar is stored per record (state and church practice may differ).

## Search, graph and ownership

**Search index:** one row per region with original and normalised text (full-text + trigram), Daitch–Mokotoff name keys (Postgres `fuzzystrmatch`) plus expanded name variants, date range, place ids expanded up the hierarchy, source kind, optional embedding (pgvector). Every hit returns its region so the UI can show the crop.

**Graph projection (Apache AGE, same Postgres):** derived, rebuildable, never edited directly.

| Node | Edges |
| --- | --- |
| Persona | APPEARS_IN → Record (role); CO_OCCURS ↔ Persona (godparent of, witness at, same house) |
| Person | SAME_AS ← Persona (link status, score); RELATED ↔ Person; PARENT_OF → Person (shortcut derived from Family) |
| Family | PARTNER ← Person; CHILD ← Person |
| Record | FROM → Source; AT → Place |
| Place | WITHIN → Place (validity) |

- Relational writes and the matching graph updates commit in the same transaction; the graph can also be rebuilt from scratch.
- No unbounded traversals: deep kinship uses recursive SQL with `CYCLE`.
- AGE label tables get explicit indexes (vertex id and properties; edge start/end ids).
- One adapter class owns all Cypher strings and `agtype` parsing.

**Ownership:** shared library = Repository, Source, DigitalCopy, Page, Region, ProcessingRun(+Item), TextLayer, Record, Persona, Assertion, Place, PlaceName, PlaceParent, NameVariant. Per project = Person, Family, PersonaLink, Relationship, ConclusionEvidence, ProofNote, project source list.

## Decisions

| Topic | Decision |
| --- | --- |
| Existing Meridian person/relationship tables | Migrate. Each existing person becomes a Person backed by a "Legacy Meridian data" source with import-agent personas and assertions. |
| Graph store | Apache AGE inside Postgres, via JDBC. Algorithms (connected components, FAN) in Java (JGraphT) or recursive SQL. |
| Page images | Read from the Drive-for-desktop folder synced to local SSD (mirror / available offline). Rendered images go to a disposable local cache. No object storage. |
| Handwritten registers | Transkribus, to evaluate later (deferred processor). |
| Arcanum API | Deferred. Newspaper pages arrive as exported PDFs with Arcanum's text layer. |
| Entity resolution | Java-native, hand-rolled: blocking (phonetic surname key, birth decade, parish), Jaro-Winkler (Apache Commons Text), date-range overlap, FAN overlap (1–2 hops), weighted score tuned from user decisions. |
| ProcessingRun granularity | One run per batch, one ProcessingRunItem per page. |
| Repository | Same repo as Meridian, multi-module, single migration history. |
