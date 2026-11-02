# 5. Evidence layer runs client-side

- Status: Proposed
- Date: 2026-11-02
- Deciders: project maintainer

## Context

Meridian is a static single-page app deployed to GitHub Pages on every push to
`master`. All data lives in the browser (IndexedDB via `StorageService`), and
sharing and backup go through the native `.zip` bundle (ADR-0001, ADR-0002).

The planned evidence layer (`docs/evidence-layer/evidence-model.md`) adds
document ingestion, OCR, information extraction with provenance, search, a
relationship graph and entity resolution. A first plan assumed a Java backend
with PostgreSQL and Apache AGE. That would require a server, end the
"open the page and it works" deployment, and split the code base.

At personal research scale (thousands of pages, tens of thousands of
assertions) a modern browser can do this work: pdf.js extracts and renders
PDFs, tesseract.js runs OCR in WebAssembly, in-memory indexes handle search
and graph queries, and IndexedDB stores the data.

## Decision

Build the evidence layer **in the existing repository, running entirely in
the browser**, with no backend:

- Evidence entities are new IndexedDB object stores, upgraded forward-only
  with tests that existing projects and blobs survive.
- Invariants that a database would enforce (append-only evidence, mandatory
  citations, user-only confirmation) are enforced by repository functions and
  tests.
- Search indexes and the graph are in-memory or serialised projections,
  always rebuildable from the stores.
- Heavy work runs in Web Workers.
- Documents are read from a local folder through the File System Access API
  (Chromium), with a file-picker fallback.
- External AI services are called from the browser with the user's own key,
  stored only on the device.
- The native bundle gains an `evidence.json` so evidence travels with a
  project; GEDCOM stays verified-only (ADR-0003).

## Consequences

- Deployment to GitHub Pages stays unchanged; there is nothing to host.
- Data stays on the user's machine; browser storage can be evicted, so the app
  requests persistent storage and regular bundle exports matter more.
- OCR is slower than a native engine, and services that block browser calls
  (CORS) or need a secret proxy cannot be used directly.
- If those limits become real, a **local ingest companion** in a separate
  repository can be added later, producing bundle-format evidence for import.
  That will be recorded in its own ADR.
- Every phase must keep `master` deployable; unfinished evidence UI sits
  behind a feature flag.
