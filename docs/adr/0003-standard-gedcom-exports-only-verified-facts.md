# 3. Standard GEDCOM exports only verified facts

- Status: Accepted
- Date: 2026-07-01
- Deciders: project maintainer

## Context

Genealogical rigor hinges on separating sourced fact from working hypothesis. A
GEDCOM shared with other researchers or tools should carry only vetted data, not
speculative entries a user is still investigating. Meridian previously exported
the whole model indiscriminately.

## Decision

Introduce a per-item boolean **`verified`** (default `false`) on facts —
`birth`/`death`, `events`, `periods`, `groups`, and `sources`.

Standard GEDCOM export (`exportGedcom`):

- **always** emits the structural skeleton: `INDI` name/sex and
  `FAM`/`HUSB`/`WIFE`/`CHIL` links (structure is shareable even before facts are
  vetted);
- **gates all facts on `verified`**: `BIRT`/`DEAT`, `EVEN`, `OCCU`, and `SOUR`
  citations appear only when the item is verified;
- maps non-standard-but-verified constructs to standard tags — role `periods` →
  `OCCU`, event-group `groups` → `NOTE`; eras and brackets are omitted
  (native-only, per ADR-0001);
- emits a `SOUR` record only for a verified source that is actually cited.

GEDCOM **import** reads `OCCU`/`EVEN`+`TYPE`/`NOTE`/`SOUR` back into the model, and
every imported item lands **unverified** — the importer cannot vouch for provenance.

## Consequences

- Exports are trustworthy: every fact in a `.ged` has been explicitly vouched for.
- Nothing exports until marked — including seeded sample data, which starts
  unverified by design. This surprised users at first (see ADR-0004).
- The model carries a new invariant the UI must expose: a way to view and toggle
  `verified` on each item.
