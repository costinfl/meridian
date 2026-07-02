# 2. Share-bundle JSON is the source of truth; media is optional

- Status: Accepted
- Date: 2026-07-01
- Deciders: project maintainer

## Context

The native `.zip` bundle (ADR-0001) carries both structured project data and
binary media (scanned PDFs, photos), which can be large. A researcher may
reasonably strip large scans from a bundle by hand before sharing, yet the
scholarly value — the source's metadata and its APA7 citation — must not be lost
when the file is gone.

## Decision

`project.json` is the **single source of truth**. It contains the full normalized
project, including every source's metadata and APA7 `citation`. The `media/`
entries are **optional** attachments keyed by `blobKey`.

On import (`importProjectZip`), for each source that references a `blobKey`:

- if the matching `media/<blobKey>…` file is present → restore the blob to storage;
- if it is **absent** → keep the source and its citation, set `fileMissing = true`,
  and clear `blobKey`.

Imported projects receive a fresh id and an "(imported)" name so importing never
clobbers an existing project.

## Consequences

- Citations and metadata survive even when media is stripped from a bundle.
- Bundles can be slimmed deliberately without data loss beyond the binaries.
- A source may legitimately reference missing media; the UI surfaces this via a
  `fileMissing` indicator.
