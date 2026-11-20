# 7. Public services called from the browser

- Status: Accepted
- Date: 2026-11-20
- Deciders: project maintainer

## Context

ADR-0005 keeps Meridian client-only: no server of its own. Two features need data or work from outside:

- **Context lanes** follow the people on the board: their places, the countries those places belonged to at the
  time, and world history over their lifetimes. A built-in sample cannot cover every place and period.
- **Read with Transkribus** sends a page image to the researcher's own Transkribus account for handwriting
  recognition.

Both services accept requests from a browser page (CORS checked on 2026-11-19 for `query.wikidata.org`,
`www.wikidata.org`, `account.readcoop.eu` and `transkribus.eu/processing/v1`).

## Decision

The page calls these public services directly; nothing goes through a server of ours.

- **Wikidata** (public data, no account, no key): only place names, Wikidata item ids and years are sent; nothing
  about people. Answers are cached on the device for 30 days; calls are spaced out and retried with backoff on 429.
  The context source switch "Built-in only (offline)" makes no calls at all.
- **Transkribus** (the researcher's own account): the page image goes to Transkribus only after the researcher
  confirms; the password is asked per browser session and never stored; tokens stay in memory.

All network code for a service lives in one module (`src/context/wikidata.js`, `src/ingest/transkribus/api.js`).

## Consequences

- No server, no hosting cost, the same GitHub Pages deployment (ADR-0005 holds).
- Context depends on Wikidata's coverage and availability: local events are sparse for small places, so the Local
  lane adds notable things founded there, the built-in sample and the researcher's own context events. Offline, the
  cached and built-in history is shown.
- If a service stops accepting browser requests, the feature degrades (Built-in only; Transkribus file import), and
  a proxy would need a new ADR.
