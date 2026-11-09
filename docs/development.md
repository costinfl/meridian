# Development guide

How to run, test, build and deploy Meridian, and the rules to follow when changing it. For how the code is organised, see [architecture](architecture.md).

- [Requirements](#requirements)
- [Set up](#set-up)
- [Commands](#commands)
- [Testing](#testing)
- [Deployment](#deployment)
- [Rules that tests enforce](#rules-that-tests-enforce)
- [Changing the database](#changing-the-database)
- [Conventions](#conventions)
- [Working on the evidence layer](#working-on-the-evidence-layer)
- [Troubleshooting](#troubleshooting)

## Requirements

| Tool | Version | Why |
| --- | --- | --- |
| Node.js | 22.22.2 or newer (CI uses 22) | Required by current npm |
| npm | Latest (12 or newer) | The committed `package-lock.json` only installs cleanly with a recent npm |
| Browser | Chrome or Edge recommended | The evidence layer relies on Chromium-only APIs |

There is no backend, database server, Docker setup or environment file. Everything runs in the browser.

## Set up

```bash
git clone https://github.com/costinfl/meridian.git
cd meridian
npm install -g npm@latest
npm ci
npm run dev
```

Open <http://localhost:5173/meridian/>. The `/meridian/` path comes from `base` in `vite.config.js`, which matches the GitHub Pages address.

If you cannot or do not want to update npm globally, use `npx -y npm@latest ci` instead of the two npm lines. Do not run `npm install` to "fix" the lockfile; it would rewrite `package-lock.json`.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload, port 5173 |
| `npm test` | Vitest in watch mode |
| `npm test -- --run` | Run all tests once (what CI runs) |
| `npx vitest run src/tests/gedcom.test.js` | Run one test file |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve `dist/` at <http://localhost:4173/meridian/> |

Before you push: `npm test -- --run` and `npm run build` must both pass.

## Testing

Tests live in `src/tests/` and run with [Vitest](https://vitest.dev/) in a jsdom environment, with [Testing Library](https://testing-library.com/) for components and [fake-indexeddb](https://github.com/dumbmatter/fakeIndexedDB) in place of the browser database.

| Kind | Examples | Notes |
| --- | --- | --- |
| Model and format | `models.test.js`, `families.test.js`, `gedcom.test.js`, `share.test.js`, `bundleV2.test.js` | Pure functions; most of the suite |
| Storage | `storage.test.js`, `upgrade.test.js`, `dbMethods.test.js` | Each test gets a fresh in-memory database |
| Evidence library | `*Store.test.js`, `fuzzyDate.test.js`, `normalize.test.js`, `personaView.test.js` | Use `freshStorage()` from `evidenceHelpers.js` |
| Components | `evidenceFlag.test.jsx`, `legacyPanel.test.jsx`, `persistence.test.jsx` | Files containing JSX must end in `.jsx` |
| Architecture | `architecture.test.js` | Scans the source tree; see below |

Things to know:

- fake-indexeddb copies `Blob` values without their prototype, so tests assert that a blob exists and check its record, not its bytes.
- jsdom has no `ResizeObserver`; tests that render `App` define a stub.
- Tests never call external services.

Checks in a real browser (upgrading a real database, file download and import) are done by hand or with a throwaway Playwright script; none are committed.

## Deployment

`.github/workflows/deploy.yml` runs on every push to `master` and on pull requests to `master`:

1. `test`: install, then `npm test -- --run`.
2. `build`: needs `test`; builds and uploads `dist/`.
3. `deploy`: needs `build`; publishes to GitHub Pages. Skipped on pull requests.

So **every merge to `master` goes live**, and a failing test blocks the release. Work on a branch and open a pull request.

Because the live app stores users' data in their browsers, a release must never lose it. See [Changing the database](#changing-the-database) and invariant I8 in the [plan](evidence-layer/IMPLEMENTATION_PLAN.md).

## Rules that tests enforce

`src/tests/architecture.test.js` fails the build when these are broken:

1. **Import boundaries.** Each folder may import only what is listed:

   | Folder | May import |
   | --- | --- |
   | `src/evidence` | `src/storage` |
   | `src/conclusions` | `evidence`, `models`, `storage` |
   | `src/ingest` | `evidence`, `storage` |
   | `src/search`, `src/graph` | `evidence` |
   | `src/storage` | nothing else |
   | `src/workers` | any non-UI folder |
   | `src/components`, `src/hooks`, `App.jsx` | anything |

   In short: evidence code never depends on conclusions or on the interface.

2. **Database access.** Only `src/storage` and `src/evidence/repositories` may call the generic store methods (`dbAdd`, `dbPut`, `dbTransact`…). This is what keeps evidence append-only.

3. **User decisions.** Code under `ingest`, `search`, `graph` and `workers` may not call `confirmAssertion`, `rejectAssertion`, `enterAsUser`, `decideLink`, `convertLegacyFacts`, `confirmLegacyVerified` or `setFactVerified`. Automated code may only propose.

The rules themselves are in `src/tests/archRules.js`.

## Changing the database

The browser database is `meridian-v1` (the name is historical; the schema version is separate). Its schema is a list of forward-only steps in `src/storage/upgrades/`:

| Version | Adds |
| --- | --- |
| 1 | `projects`, `blobs` |
| 2 | `settings` (device-local values, never exported) |
| 3 | Evidence library: repositories, sources, copies, pages, regions, runs, run items, raw outputs, text layers, page cache |
| 4 | Places, place names, place parents, name variants, records, personas, assertions |
| 5 | Assertion decisions; a supersession index on regions |

To change the schema:

1. Add `vN.js` with `{ version: N, up(db, tx) { … } }` and append it to `UPGRADES` in `upgrades/index.js`.
2. **Never edit or remove a step that has shipped.** Users' databases have already run it.
3. Only add stores or indexes, or transform data without losing any.
4. Add a test to `upgrade.test.js` that builds a database at version N−1 with data (using `UPGRADES.slice(0, N-1)`), upgrades it, and checks the data survived.
5. Tell reviewers to export a bundle before merging.

The project document itself is upgraded on load by `normalizeProject` in `src/models/project.js`. It must be idempotent and must return the same object when nothing needs changing.

## Conventions

- Plain JavaScript with ES modules. No TypeScript.
- React function components with inline styles; colours and shared styles come from `src/theme.js`. No UI library, no CSS framework.
- Components never touch IndexedDB directly; they go through `StorageService`.
- No `localStorage`. Device-local values go in the `settings` store.
- Long-running work belongs in Web Workers (`src/workers/`).
- Avoid top-level `await`; the build target does not allow it.
- New libraries must work on a static site and be loaded lazily if large.
- There is no linter or formatter configured; match the surrounding code.
- Architecture decisions are recorded as ADRs in `docs/adr/`; see its [README](adr/README.md) for the format.

## Working on the evidence layer

The evidence layer is built in reviewed phases. Before changing it, read, in this order:

1. [`evidence-layer/PROGRESS.md`](evidence-layer/PROGRESS.md): current phase, decisions, open questions.
2. [`evidence-layer/IMPLEMENTATION_PLAN.md`](evidence-layer/IMPLEMENTATION_PLAN.md): operating rules, invariants I1 to I9, tasks.
3. [`evidence-layer/evidence-model.md`](evidence-layer/evidence-model.md): the design contract.

Unfinished interface stays behind the `evidenceUi` flag (`src/evidenceFlag.js`): a project setting, or `?evidence=1` in the address.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `npm ci` says package.json and package-lock.json are not in sync | npm is too old. `npm install -g npm@latest`, or `npx -y npm@latest ci` |
| `npm install -g npm@latest` fails with `EBADENGINE` | Node is older than 22.22.2. Update Node |
| Blank page at `http://localhost:5173/` | Use `http://localhost:5173/meridian/` |
| A test file fails to parse | It contains JSX but ends in `.js`. Rename it to `.jsx` |
| The app hangs on load after a schema change | Another tab holds the old database version. Close other Meridian tabs and reload |
| You want a clean start | Browser devtools → Application → IndexedDB → delete `meridian-v1`, then reload (the sample project is recreated) |
| The local app has none of your data from the public site | Expected: browser storage is separate per address. Move data with a bundle |
