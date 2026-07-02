# 1. Two-track export: native bundle vs. standard GEDCOM

- Status: Accepted
- Date: 2026-07-01
- Deciders: project maintainer

## Context

Meridian's domain model is richer than the genealogy interchange standard,
GEDCOM 5.5.1, can represent. Per person we store typed `events`, role `periods`,
event-group `groups`, and `media`; at the project level we store `annotations`
(brackets), `eras`, and `sources` with APA7 citations. GEDCOM is an
individual-centric lineage format: some of this maps to standard tags (`OCCU`,
generic `EVEN`+`TYPE`, `NOTE`, `SOUR`), but project-level constructs (historical
eras, research brackets) have no standard home and would only fit through
non-portable custom `_` tags.

Two needs pull in different directions:

1. Share a project with **full fidelity** between Meridian users.
2. **Interoperate** with mainstream genealogy tools, which speak GEDCOM.

## Decision

Provide **two** distinct export formats rather than stretching one to cover both:

- A **native `.zip` bundle** (`src/share.js`) — `project.json` plus a `media/`
  folder — for lossless Meridian-to-Meridian sharing.
- A **standard GEDCOM 5.5.1** file (`src/gedcom.js`) for interop, explicitly
  accepting that it is a lossy projection of the model.

We will **not** encode non-standard data in custom `_` GEDCOM tags. Anything
without a standard home is either mapped to a standard `NOTE` or omitted
(see ADR-0003).

## Consequences

- Standard GEDCOM stays clean, idiomatic, and portable to other tools.
- Native sharing loses nothing, including media and citations (see ADR-0002).
- Two export paths, surfaced through an `Export ▾` menu that labels each format.
- Two import paths, dispatched by file extension (`.zip` vs. `.ged`).
