# Architecture

How Meridian is put together. For commands and rules, see the [development guide](development.md). For the reasons behind major choices, see the [ADRs](adr/README.md).

- [At a glance](#at-a-glance)
- [Source layout](#source-layout)
- [Runtime flow](#runtime-flow)
- [The project document](#the-project-document)
- [Storage](#storage)
- [The evidence library](#the-evidence-library)
- [Conclusions](#conclusions)
- [File formats](#file-formats)
- [What is not built yet](#what-is-not-built-yet)

## At a glance

- A single-page React 18 application built with Vite 5 and deployed as static files to GitHub Pages. There is no backend ([ADR-0005](adr/0005-evidence-layer-runs-client-side.md)).
- All data is in the browser's IndexedDB. Sharing and backup go through a `.zip` bundle ([ADR-0001](adr/0001-two-track-export-native-bundle-vs-standard-gedcom.md), [ADR-0002](adr/0002-share-bundle-json-is-source-of-truth.md)).
- Two kinds of data:
  - a **project**: one JSON document holding the timeline, its sources and the researcher's conclusions;
  - the **evidence library**: shared across projects, holding documents, text and atomic claims with their citations.
- Runtime dependencies are `react`, `react-dom` and `jszip`.

```
            ┌──────────────────────── browser ────────────────────────┐
            │  App.jsx + components        (interface)                │
            │        │                                                │
            │  hooks/useProject            (load, edit, autosave)     │
            │        │                                                │
            │  models/  conclusions/       (project document logic)   │
            │        │            │                                   │
            │        │       evidence/     (shared evidence library)  │
            │        │            │                                   │
            │  storage/StorageService → IndexedDB adapter             │
            │                         │                               │
            │                    IndexedDB "meridian-v1"              │
            └─────────────────────────────────────────────────────────┘
       share.js ⇄ .zip bundle          gedcom.js ⇄ .ged file
```

## Source layout

```
src/
  main.jsx                 entry point
  App.jsx                  the timeline board, toolbar and dialogs
  theme.js                 colours, shared styles, event and source types
  sampleData.js            the Hariton sample people, eras, brackets and context lanes
  evidenceFlag.js          the evidenceUi feature flag
  gedcom.js                GEDCOM 5.5.1 export and import
  share.js                 .zip bundle export and import

  components/
    ItemModal.jsx          view and edit a timeline item
    SourcesPanel.jsx       the sources side panel
    ProjectManager.jsx     the Projects dialog
    Modal.jsx              shared dialog frame
    evidence/              evidence interface, loaded lazily (EvidencePanel.jsx)

  hooks/useProject.js      current project state, mutations, autosave

  models/
    project.js             project and item factories, normalizeProject, displayName
    families.js            families and the fields derived from them

  conclusions/             logic that connects a project to the evidence library
    personaLinks.js        "this persona is this person" decisions
    legacyFacts.js         timeline facts recorded as evidence
    linkLegacySource.js    a project source linked to a library source
    displayName.js         which name a person is shown under
    evidenceSeeds.js       what a project references in the library
    conclusions.js         relationships, conclusion evidence, proof notes

  evidence/                the shared evidence library (no interface code)
    index.js               createEvidenceLibrary(storage)
    domain/                pure helpers: fuzzyDate, normalize, daitchMokotoff, box, validity, hash
    repositories/          one module per group of stores; the only code that reads or writes them

  storage/
    StorageService.js      the single entry point for persistence
    adapters/IndexedDBAdapter.js
    upgrades/              database schema steps v1…v5
    persistence.js         persistent-storage request and status

  ingest/ search/ graph/ workers/     placeholders for later phases
  tests/                   the test suite
```

Dependencies point one way: interface → conclusions → evidence → storage. A test enforces it (see the [development guide](development.md#rules-that-tests-enforce)).

## Runtime flow

1. `useProject(storage)` lists the stored projects. If there are none it creates the sample project. It loads the most recent one through `normalizeProject`.
2. `App.jsx` renders the board from that project. `x(year) = (year − view.left) × ppy`, where `ppy` is pixels per year; every lane uses the same transform.
3. Each edit calls a mutation from `useProject` (for example `updatePerson`). The hook replaces the project object, marks it dirty, and saves it 1.5 seconds after the last change.
4. Heavy or optional code is split out: the evidence panel, the evidence library and the legacy conversion load only when used.

## The project document

One object per project, stored whole in the `projects` store.

```js
{
  id, name, description, createdAt, updatedAt,

  people: [{
    id, name, sex,                         // "M" | "F" | "U"
    birth: { year, place, verified, assertionIds, preferredAssertionId },
    death: { year, place, verified, assertionIds, preferredAssertionId },
    events:  [{ id, year, label, type, note, color, sourceId, verified, assertionIds, preferredAssertionId }],
    periods: [{ id, start, end, label, note, color, sourceId, verified, … }],   // roles, occupations
    groups:  [{ id, start, end, label, note, color, sourceId, verified, … }],   // event groups
    media:   [{ id, year, sourceId, label, color }],                            // media pins
    fatherId, motherId, spouseIds,         // DERIVED from families; do not edit directly
    displayNameChoice                      // { personaId, name, chosenAt } or null
  }],

  annotations: [{ id, laneKey, start, end, title, note, color, sourceId }],     // research brackets
  eras:        [{ id, start, end, label, color, note, sourceId }],
  sources:     [{ id, title, type, date, repository, description, citation, url, text,
                  blobKey, fileName, mimeType, fileMissing, linkedPersonIds, linkedYearRange,
                  tags, verified, librarySourceId, createdAt }],

  // conclusions
  families:           [{ id, partner1Id, partner2Id, children: [{ personId, order }], marriage, status, rationale }],
  personaLinks:       [{ id, personId, personaId, status, score, signals, method, rationale,
                         decidedBy, decidedAt, supersedesId, createdAt }],
  relationships:      [{ id, personAId, personBId, type, status, rationale, createdAt }],
  conclusionEvidence: [{ id, conclusion: { kind, id }, assertionId, stance, createdAt }],
  proofNotes:         [{ id, subjects: [{ kind, id }], text, createdAt }],
  legacyEvidence:     { librarySourceId, copyId, regionId, convertedAt, runIds } | null,

  settings: { focusPersonId, relativeIds, view: { left, ppy }, ctxOn, evidenceUi }
}
```

Points to remember:

- **`normalizeProject`** upgrades older documents when they are loaded: it adds missing arrays and ids, adds the evidence fields to facts, builds `families` the first time, and afterwards derives `fatherId`, `motherId` and `spouseIds` from `families`. It returns the same object when nothing changed.
- **Families are the source of truth** for parents and spouses. `partner1Id` fills the father slot and `partner2Id` the mother slot, matching GEDCOM `HUSB`/`WIFE`. Change relationships with `setParents`, `addPartners` and `removePartners` in `models/families.js`.
- **`verified`** decides what GEDCOM export includes ([ADR-0003](adr/0003-standard-gedcom-exports-only-verified-facts.md)) and how an item is drawn ([ADR-0004](adr/0004-verified-sourcing-visual-affordance.md)).
- **`name`** is the canonical name and what GEDCOM exports. `displayName(person)` returns the chosen display name if there is one.
- Dates on the timeline are whole years.

## Storage

`StorageService` is the only persistence entry point; it delegates to an adapter (`IndexedDBAdapter`), which can be replaced with `setAdapter`.

| Store | Holds | Notes |
| --- | --- | --- |
| `projects` | Project documents | Key `id` |
| `blobs` | Files attached to sources and evidence copies | Key `key` |
| `settings` | Device-local values such as the last export time | Never exported |
| `ev…` stores | The evidence library | See below |

The schema is a list of forward-only upgrade steps (`storage/upgrades/v1.js` … `v5.js`). When another tab needs to upgrade, an open connection closes itself so the upgrade is not blocked.

Evidence code reaches the database through generic methods on the service (`dbAdd`, `dbPut`, `dbGet`, `dbGetAllByIndex`, `dbTransact`…). `dbAdd` refuses an existing key; `dbTransact` runs several stores in one all-or-nothing transaction. Only the repositories may call these.

IndexedDB has no triggers or foreign keys, so every rule below is enforced by repository code and tests, not by the database.

## The evidence library

Created with `createEvidenceLibrary(storage)`, which returns one object per area. The design contract is [`evidence-model.md`](evidence-layer/evidence-model.md); this is a map of what exists.

| Layer | Library member | Stores | What it represents |
| --- | --- | --- | --- |
| 1 Sources | `repositories`, `sources` | `evRepositories`, `evSources` | Where material is held; the original work (register volume, newspaper issue…) |
| 1 | `copies` | `evCopies` | One file of a source. Identity is the SHA-256 of its content |
| 1 | `pages` | `evPages`, `evRegions` | Pages of a copy and located regions on them. Boxes are normalised to 0–1 |
| 2 Text | `runs` | `evRuns`, `evRunItems`, `evRawOutputs` | Each execution of a processor, its per-page outcome and raw output |
| 2 | `textLayers` | `evTextLayers` | Text read from a region by a run |
| 3 Evidence | `records` | `evRecords`, `evPersonas` | An entry in a source and the people it mentions, as written |
| 3 | `assertions` | `evAssertions`, `evAssertionDecisions` | One claim about a record or persona, with its citation; decisions are separate events |
| 3 | `personaView` | — | A persona's current confirmed facts, computed on demand |
| Reference | `places`, `nameVariants` | `evPlaces`, `evPlaceNames`, `evPlaceParents`, `evNameVariants` | Places with names and parents valid over time; spelling pairs |
| Exchange | `bundle` | — | Collect and merge evidence for bundles |

Rules the library keeps (numbered as in the [plan](evidence-layer/IMPLEMENTATION_PLAN.md)):

- **Append-only (I1).** Text layers, regions and assertions are never edited or deleted. A correction is a new row with `supersedesId`; a confirm or reject is a row in `evAssertionDecisions`.
- **Citations (I2).** An assertion cites a region. Manual entries may cite a source and page label; imports may cite a source.
- **Provenance (I3).** Text layers and assertions name the run that produced them.
- **Coordinates (I4).** Region and word boxes are 0–1 on the unrotated page; a child region lies inside its parent.
- **Direction (I5).** Evidence code imports nothing from conclusions or the interface.
- **User decisions (I6).** Automated code can only propose. Confirming, rejecting, linking and replacing a confirmed assertion are user actions.
- **Nothing private leaves (I9).** Settings, keys and folder handles are never written to a bundle.

Domain helpers worth knowing:

- `fuzzyDate.js`: a date as a range of Julian Day Numbers with a calendar flag, so Julian and Gregorian records compare correctly; ranges from a stated age.
- `normalize.js`: Romanian folding (`ş`→`ș`, accents removed for matching) and name keys.
- `daitchMokotoff.js`: phonetic codes for names.

Duplicate files are flagged, not merged silently: identical bytes return the existing copy; the same name with different bytes is kept as a possible new version until a person chooses *keep both* or *replace*. A replaced copy is kept, marked superseded, because evidence read from it still cites it.

## Conclusions

Conclusions are the researcher's decisions and live in the project document, so the timeline, bundle and GEDCOM code keep working.

- **PersonaLinks** (`conclusions/personaLinks.js`): an append-only list. `addLink` creates a candidate; `decideLink` adds a superseding accepted or rejected link. Rejected pairs are remembered.
- **Legacy facts** (`conclusions/legacyFacts.js`): `dryRunLegacyConversion` reports; `convertLegacyFacts` records timeline facts as proposed import assertions on a persona that is linked to its person as a *candidate*. A birth or death becomes a `birth.date` / `death.date` assertion (a year-precision FuzzyDate) and a `birth.place` / `death.place` assertion; an event, role or group becomes one `x-legacy.*` assertion. `confirmLegacyVerified` confirms the assertions of verified facts. `applyFactEdit` runs when a converted fact is edited: changed content supersedes the old assertion (agent `manual`), and a fact is verified exactly when all its active assertions are confirmed.
- A fact's `assertionIds` lists every assertion ever made for it; the *active* ones are those no later assertion supersedes; `preferredAssertionId` is the primary one (the date, for a birth or death).
- **Display name** (`conclusions/displayName.js`): the first accepted persona's name by default, or the researcher's choice.

## File formats

### Meridian bundle (`.zip`)

| Entry | Content |
| --- | --- |
| `project.json` | The project document. The source of truth |
| `media/<blobKey>-<fileName>` | Attached files; optional. A missing file sets `fileMissing` on its source at import |
| `evidence.json` | ([ADR-0006](adr/0006-native-bundle-carries-evidence.md)) Only when the project references evidence: `{ format: "meridian-evidence", version: 1, … }` with the library rows the project depends on. No raw outputs, page cache or settings |

Import gives the project a new id and "(imported)" name, saves the media, and merges `evidence.json` into the library in one transaction: rows are matched by id, copies by content hash (their pages and regions are remapped), and nothing existing is overwritten.

### GEDCOM 5.5.1

| Meridian | Export | Import |
| --- | --- | --- |
| Person name, sex | `INDI`, `NAME Given /Surname/`, `SEX` | Read |
| Birth, death | `BIRT` / `DEAT` with `DATE` (year) and `PLAC`, verified only | Year and place read; unverified |
| Role / occupation | `OCCU` with `DATE FROM … TO …`, verified only | Read |
| Event | `EVEN` with `TYPE` and `DATE`, verified only | Read |
| Event group | `NOTE` "Label (start–end)", verified only | Read back from that pattern |
| Families | `FAM` with `HUSB`, `WIFE`, `CHIL`; `FAMC` / `FAMS` | **Not read** |
| Source | `SOUR` record with `TITL`, `PUBL`, `TEXT`, cited when fact and source are verified | Read |
| Brackets, eras, media pins, colours | Not exported | — |

## What is not built yet

`src/ingest`, `src/search`, `src/graph` and `src/workers` are empty placeholders. Planned phases:

| Phase | Adds |
| --- | --- |
| 5 | Linking a documents folder, PDF and DOCX text, OCR |
| 6 | Extraction of records and people, and a review interface |
| 7 | Search |
| 8 | Relationship graph queries |
| 9 | Matching the same person across records |

Details are in the [plan](evidence-layer/IMPLEMENTATION_PLAN.md).
