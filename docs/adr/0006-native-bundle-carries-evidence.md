# 6. Native bundle carries the evidence a project references

- Status: Accepted
- Date: 2026-11-09
- Deciders: project maintainer
- Extends: [ADR-0002](0002-share-bundle-json-is-source-of-truth.md)

## Context

The native `.zip` bundle is Meridian's backup and sharing format (ADR-0001). ADR-0002 made
`project.json` the source of truth and media files optional.

The evidence layer (ADR-0005) stores sources, document copies, pages, regions, text,
records, personas and assertions in a **library shared by all projects** in the browser,
outside the project document. A project only holds references to it (assertion ids on
facts, persona links, linked sources). A bundle with `project.json` alone would restore a
project whose references point at nothing, and a backup would silently lose the evidence.

## Decision

A bundle may contain a third entry, **`evidence.json`** ("bundle v2"):

- It holds the library rows the project depends on: the entities the project references
  plus everything those depend on (their regions, pages, copies, sources, runs, places,
  correction chains and decisions).
- It is written only when the project references evidence. A project without evidence
  exports exactly as before.
- It never contains device-local data: no settings, API keys or folder handles. Raw
  processor outputs and rendered page caches are also left out (they can be regenerated).
- Files of copies stored in the browser travel in `media/`, like source attachments, and
  stay optional.
- On import, `evidence.json` is merged into the library in one all-or-nothing transaction.
  Rows are matched by id and document copies by content hash; **nothing already in the
  library is overwritten**, and an existing assertion keeps its own decision.
- `project.json` remains the source of truth for the project. Bundles without
  `evidence.json` import as before, and an older build ignores the extra entry.
- The entry is versioned (`format: "meridian-evidence"`, `version: 1`); an unknown format
  or version is rejected before anything is written.

## Consequences

- A bundle is a complete backup again: project, attachments and evidence.
- Sharing a project shares the evidence it rests on, including what the recipient's
  library already has (merged, not duplicated).
- Because import never overwrites, two researchers who edited the same library row keep
  their own version; reconciling such differences is not solved here.
- Bundles grow with the amount of evidence. Text layers are the largest part; raw outputs
  were excluded for that reason.
- The library's shape is now part of an exchange format, so changes to it need a new
  `version` and an import path for older bundles.
