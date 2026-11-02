# Meridian Evidence Layer — Tech Stack Assessment

Status: **proposal for reviewer decision** (answers Open question 1 in `PROGRESS.md`).
Date: 2026-11-02. Scope: what the evidence layer should be built on, given that the plan's Java + Postgres backend does not fit this repository.

## 1. Context that drives the choice

Facts about Meridian today (from Phase 0):

- Client-only React 18 + Vite 5 SPA, deployed as static files to GitHub Pages. No server, no database server, no secrets store.
- Data lives in browser IndexedDB (whole project as one JSON document, blobs in a second store). Share bundle `.zip` + GEDCOM are the only exchange formats.
- A swappable `StorageService` adapter seam already exists.
- Existing code is JavaScript (JSX), tests are Vitest; there is no Java anywhere.

Facts about the design (`evidence-model.md`) that constrain the stack:

- Page images come from a Google-Drive-for-desktop folder on the user's own disk. No object storage. Rendered images are a disposable cache.
- The product appears to be a **single-researcher tool** (one user's library, projects, review queue). Nothing in the design needs multi-user concurrency, accounts or a shared server.
- Needed data capabilities: append-only relational tables with constraints/triggers, date-range overlap queries, trigram + full-text search, Daitch–Mokotoff phonetic keys, diacritic folding, recursive kinship queries with cycle protection, a rebuildable graph projection, optional embeddings.
- Needed processing: PDF page splitting/rendering, embedded text extraction, OCR (Romanian), DOCX/DOC text, LLM extraction (API key), long-running batches with retry.

## 2. What the design really needs from Postgres

The plan bundles five extensions plus Java. Taking them one at a time:

| Need | Plan's answer | Is a Postgres *server* required? |
| --- | --- | --- |
| Date-range overlap | `daterange` + GiST | No. Any engine with range indexes, or two integer columns with a btree. |
| Fuzzy / text search | `pg_trgm`, `tsvector`, `unaccent` | No. Available in Postgres-in-WASM (below) or SQLite FTS5 (trigram tokenizer). |
| Phonetic keys | `fuzzystrmatch` `daitch_mokotoff()` | No. Available in WASM Postgres; also pure-JS implementations exist (unverified which). |
| Recursive kinship | recursive SQL + `CYCLE` | No. Works on any modern Postgres, including WASM. |
| Graph (FAN, clusters) | Apache AGE + Cypher + JGraphT | **Weakest justification.** A family research graph is thousands to low hundreds of thousands of nodes; recursive SQL plus an in-memory graph (JS graph library) covers 1–2-hop FAN and connected components. AGE adds an adapter, `agtype` parsing, index tuning and a custom Postgres image for little gain. |
| Embeddings | `pgvector`, behind a feature flag | Backlog only. Not needed now. |

Conclusion: the design is relational plus modest text/phonetic search. It does not need a server database, and AGE should be dropped (recorded as a proposed deviation, see §6).

## 3. Verified spike

Run in a scratch directory, not committed: `@electric-sql/pglite` 0.5.14 (Postgres 18.6 compiled to WASM) under Node 22.

| Check | Result |
| --- | --- |
| `CREATE EXTENSION` for `fuzzystrmatch`, `pg_trgm`, `unaccent`, `btree_gist` | Works. Startup + all checks ≈ 4 s cold. |
| `daitch_mokotoff('Stefan')` vs `daitch_mokotoff('Ștefan')` | **Different** (276000 vs 376000): DM does not fold diacritics. |
| `unaccent` on comma-below (Ș, Ț) and cedilla (Ş, Ţ) forms | Both fold to "Stefan"/"Tara"; `daitch_mokotoff(unaccent('Ștefan'))` equals `daitch_mokotoff('Stefan')` (276000). This confirms the plan's P3.T4 requirement: fold, then key. |
| `daterange` column + GiST index, 20 000 rows, overlap query | Works, correct result. |
| Recursive CTE with `CYCLE` over a 2-node loop | Terminates, correct. |
| `pgvector` | **Not shipped** with this PGlite version (no vector module in the package). Acceptable: embeddings are backlog. |
| Apache AGE | Not available in PGlite. Confirms graph must be done without AGE. |

Not verified (stated so nobody assumes otherwise): PGlite persistence in a real browser (OPFS/IndexedDB) and its performance at library scale; `tesseract.js` Romanian accuracy and speed; the File System Access API across the user's browsers; DOC (not DOCX) text extraction in JS.

## 4. Options

| | A. Java + Spring + Postgres (the plan) | B. Node/TS service + Postgres | C. Local-first: browser app + WASM Postgres (PGlite) | D. Local helper app (Node) + SQLite/PGlite file |
| --- | --- | --- | --- | --- |
| Fit with repo | Poor: new language, build, CI, hosting; SPA must be rewired to an API | Medium: same language, but still a server to host and secure | **Good**: same language, same deploy, uses the existing adapter seam | Medium: extra process the user must run |
| Hosting / ops | Server + DB + backups + auth (Pages can't host it) | Same | None; stays on Pages | None (runs locally) but install friction |
| Data features | Full Postgres (+ AGE if built) | Full Postgres | Postgres 18 subset: trigram, DM, unaccent, ranges, recursive CTE. No AGE, no pgvector (for now) | Same as C or SQLite FTS5 |
| Local Drive folder access | Needs path on server; only works if the server runs on the user's machine | Same | File System Access API (Chromium; permission re-grant per session unless handle is persisted) | Direct filesystem |
| OCR / PDF | PDFBox, Tika, Tess4J: best-in-class, simple | Native tesseract/mupdf via child process | `pdf.js` + `tesseract.js` (WASM) in Web Workers: slower, lower accuracy ceiling | Native tools: best |
| LLM API key | Server env var, safe | Server env var, safe | **Browser-held key (bring-your-own-key).** Acceptable for a single researcher on their own machine; unacceptable for shared use | Local env var, safe |
| Durability of evidence | Server DB, backups | Same | **Risk**: browser storage can be evicted or cleared; mitigations needed (persistent storage request, automatic export) | File on disk, easy backup |
| Multi-user / sharing | Native | Native | Not supported; sharing stays via bundle export | Not supported |
| Delivery effort | Highest | High | **Lowest** | Medium |

## 5. Recommendation

**Option C — local-first, in the browser — as the default, with Option D as the planned upgrade path if its limits bite.** Reasons:

1. It matches the product as it exists: a serverless, single-user app on GitHub Pages with an adapter seam ready for a new store.
2. The spike shows the evidence-layer data features that matter (phonetics, trigram, unaccent, ranges, recursive SQL) work without a server.
3. It removes the entire Java/Postgres/hosting/auth/CORS/secrets surface that Phase 1 would otherwise have to build.
4. Keeping the evidence store behind a thin repository interface lets us move to a local Node helper (D) or a hosted Postgres (B) later without changing the schema, because the SQL is already Postgres-dialect.

Costs the reviewer must accept with C:

- **Durability.** Evidence is worth more than the current JSON projects. Required mitigations: request persistent storage, auto-export the full database plus bundle on a schedule/after review sessions, and an integrity check on load. Scans themselves are never stored in the browser; the Drive folder holds them, and only the content hash and a file handle are kept.
- **Browser support.** Folder access needs a Chromium-based browser. Firefox/Safari users could only import files manually.
- **OCR quality and speed.** `tesseract.js` is slower and a little less accurate than native Tesseract; acceptable for a trial, and it is a processor behind an interface so a native or cloud OCR can replace it. Handwriting stays deferred (Transkribus).
- **API key in the browser** for LLM extraction. Acceptable only because the user is the sole user and supplies their own key; it must be kept out of share bundles, exports and the repository. If the product ever becomes multi-user or hosted, this moves to a server (Option B).
- **Long-running batches** run in a Web Worker and must be resumable (progress persisted per `ProcessingRunItem`); closing the tab pauses, not loses, work.

Switch to D or B if any of these turn out true: OCR volume/accuracy in the browser is unacceptable on real scans; the library is too large for browser storage; the user wants other people to use it; or a non-Chromium browser is required.

## 6. Effect on the plan (to apply after the decision)

Not yet applied; proposed so the reviewer can approve in one go.

| Plan item | Change |
| --- | --- |
| Operating rules: "Postgres (Testcontainers)", Java build | Tests run in Vitest against PGlite (real Postgres engine, in memory). No Docker. |
| Modules `meridian-*` (Java) | One workspace of JS packages under `src/evidence/` (or `packages/`): `evidence`, `conclusions`, `ingest`, `graph`, with an import-boundary lint/test enforcing I5. |
| P1.T2 ArchUnit | `dependency-cruiser` (or an ESLint import rule) plus a failing-fixture test. |
| P1.T3 Docker image with 5 extensions | Pin `@electric-sql/pglite` and the contrib modules actually used (`fuzzystrmatch`, `pg_trgm`, `unaccent`, `btree_gist`); drop `age` and `vector`. |
| P1.T4 Flyway | A forward-only SQL migration runner of our own (ordered files, applied-version table) executed on store open; existing projects imported, never mutated. |
| P1.T6 document-root properties | In-app settings: folder handle, cache size, raw-output retention. |
| P5 PDFBox / Tika / Tess4J | `pdf.js`, `mammoth` (DOCX), `tesseract.js`; DOC deferred unless needed. |
| P8 AGE | Replace with recursive SQL + in-memory graph projection (JS graph library); keep I7 (rebuildable from tables). |
| P7.T5 pgvector | Stays backlog. |
| Invariants I1–I7, evidence-model.md | Unchanged. Triggers/constraints for I1 and I3 are plain Postgres and run on PGlite. |

## 7. Decisions requested

1. Approve Option C as the base stack (or choose B or D).
2. Approve dropping Apache AGE and pgvector from scope.
3. Confirm the single-researcher assumption (it is what makes the browser-held API key and no-server model acceptable).
4. Confirm Chromium-only folder access is acceptable.
5. Approve the durability mitigations as a Phase 1 requirement.
