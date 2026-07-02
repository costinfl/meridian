# Architecture Decision Records

This directory records the significant architectural decisions made on Meridian,
using a lightweight [MADR](https://adr.github.io/madr/)-style format.

## What is an ADR?

An ADR captures a single architectural decision: the **context** (the forces and
problem), the **decision** taken, and the resulting **consequences**. Records are
immutable once accepted — to change a decision, add a new ADR that supersedes the
old one rather than editing history.

## Index

| #    | Title                                                                              | Status   |
| ---- | ---------------------------------------------------------------------------------- | -------- |
| [0001](0001-two-track-export-native-bundle-vs-standard-gedcom.md) | Two-track export: native bundle vs. standard GEDCOM        | Accepted |
| [0002](0002-share-bundle-json-is-source-of-truth.md)             | Share-bundle JSON is the source of truth; media is optional | Accepted |
| [0003](0003-standard-gedcom-exports-only-verified-facts.md)      | Standard GEDCOM exports only verified facts                 | Accepted |
| [0004](0004-verified-sourcing-visual-affordance.md)              | Verified/unverified sourcing affordance                     | Accepted |

## Adding a record

1. Copy the shape of an existing ADR and give it the next sequential number.
2. Status starts **Proposed**, becomes **Accepted** when merged, or **Superseded
   by #N** when a later record replaces it.
3. Keep it short — the decision and its consequences matter more than prose.
