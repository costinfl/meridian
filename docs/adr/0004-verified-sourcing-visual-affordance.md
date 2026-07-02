# 4. Verified/unverified sourcing visual affordance

- Status: Accepted
- Date: 2026-07-01
- Deciders: project maintainer

## Context

With `verified` now gating GEDCOM export (ADR-0003), users need to see at a glance
which facts on the timeline are sourced. The first implementation rendered
unverified markers with a dashed, hollow treatment and verified ones solid and
filled — but the legend only illustrated solid swatches, and all seeded sample data
was unverified. The result: every marker looked dashed and read as a rendering bug
rather than an intentional signal.

## Decision

Adopt a consistent, documented convention:

- **Unverified** markers render **dashed, hollow**; **verified** markers render
  **solid, filled** with a ✓.
- Centralize the treatment in `src/theme.js` (`verifiedMarker`, `verifiedTick`,
  `verifiedBorderStyle`) so every lane item and the legend draw from one source and
  cannot drift.
- The legend documents the convention explicitly ("Border shows sourcing"), and a
  few sample facts ship **verified** so the default view demonstrates both states.

## Consequences

- Sourcing state is legible at a glance without opening each item.
- The legend and the rendered markers are guaranteed consistent via the shared
  helper.
- Sample data shows the contrast on first load, avoiding the "looks broken" reaction.
