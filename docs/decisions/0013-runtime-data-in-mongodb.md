---
title: Runtime Data Lives in MongoDB
type: adr
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-10-19
audience: internal
---

# 0013. Runtime Data Lives in MongoDB

> Where the editorial and reference data the server serves is kept once it leaves the repository: datasets in one content database, edited only with `npm run data`, checked at push with the server's own compiled schemas and rules, and read by every replica within a stated bound. Read it before you move a committed data file to MongoDB, change a dataset's schema, or remove an identity a dataset may reference.

## Status

Accepted — 2026-10-19, shipped in PR #289 (reader) and PR #290 (committed file removed), each verified byte-identical in production. The decisions come from the OpenSpec change `move-runtime-data-to-db` (`openspec/changes/archive/2026-10-19-move-runtime-data-to-db/design.md`), whose pilot dataset is the home layout.

It amends [ADR 0010](0010-server-architecture.md) D5 ("Static JSON" fails the boot) for data that leaves the repository, and replaces ADR 0010 D13's "server `src/` ↔ server `scripts/`" row for datasets. It relies on [ADR 0012](0012-runtime-roles.md): a script writes, and every replica reads within a TTL.

## Context

- Editorial and reference data the server serves (layouts, banners, the mini app registry, timetables, stop catalogs) is committed JSON. Every edit is a pull request, a review and a production deploy, and a bad edit fails the boot of every replica.
- ADR 0012 made "a writer stores it, every replica reads it within a bound" hold for data in MongoDB. Data a script writes reaches the replicas without a restart.
- Scripts are CommonJS outside `tsconfig`. Some keep hand-written validators that mirror a server schema, and an equivalence spec covers only the inputs it samples.
- A layout names identities other data owns (a home tile names a mini app). A deploy can remove such an identity while stored data still names it, and no push sees that.

## Decision

### D1. Datasets are the source of truth

Runtime data that moves out of the repository is stored as a dataset: one document `{ _id: <dataset>, revision, data, updatedAt, updatedBy }` in the `datasets` collection of one content database, named by the required value `MONGO_CONTENT_DB_NAME` (scope `all`, with the `_dev` and `_test` suffixes of every database name). `data` is exactly what the server's schema parses. A dataset is one document while it is read whole, edited as one unit and well under 1 MB. Per-entity documents come only when a dataset is read one entity at a time, written entity by entity by a poller, or outgrows that size; its `datasets` document then stays its header, carrying the revision and the author.

Once a dataset is stored, the repository holds no copy of it: no committed file, no fallback in the image.

### D2. Identities stay in code

What the code branches on stays in code: route ids, service ids, enums, the origins in `src/infra/origins.ts`, UI-label translations, and the hash-locked notices contract files. A dataset holds the data that names those identities, never the identities themselves. The mini app registry stays in code in the first stage, and datasets reference it as a code-held source.

### D3. The tool is the only writer

`npm run data` (`pull`, `push`, `history`, `rollback`, `copy-prod-to-dev`, `check`) is the only writer of the content database in this stage. The server only reads it, and no admin API or app edit writes it. The tool targets the `_dev` database unless `--prod` is given, prints the database name and the diff before a production write and asks to confirm it, refuses a working file pulled from the other target, and never prints `MONGO_URL`.

### D4. Every version is kept, and a push is based on one

Every push, rollback and copy records the stored version in `dataset_revisions` (`<dataset>@<revision>`), the current one included. The newest 50 revisions of each dataset are kept, and the current one is never pruned. A rollback stores an earlier revision's data as a new revision; history is never rewritten.

A push names the revision it was pulled at and is stored only if the dataset is still at that revision, in one conditional update. Otherwise it writes nothing and reports the current revision, its author and its time. The dataset is written before its history entry, with no transaction, so only the winner of the update writes history; a run that finds the current revision without an entry records it before anything else, except where a run writes nothing to production before a confirmation: there it records the entry as the first step of the confirmed write.

### D5. Validation is the server's compiled code; references are declared per dataset

The tool runs over `dist/`, built from the same checkout first, so a push is checked by the zod schema the server's repository parses the dataset with and by the same pure `.rules` functions, never by a copy. Each dataset declares its checks in the tool's catalog: its schema, the issues a schema cannot hold, the identities it references, and, if others reference it, the identities it holds. A push runs the schema, the dataset's own issues, its outgoing references and the incoming references of every stored dataset that names it, collects every issue with its dataset and path, and refuses on any. `check` runs the same checks on stored data and writes nothing.

### D6. The read contract

Every reader of a dataset keeps the same contract:

- **A bound on freshness.** A cached loader with a 60-second TTL and `serveStale: "on-reload-failure"`, so every replica serves a push within a minute while the database answers.
- **A stale window.** After a good read, a reload that fails serves the last good value for 24 hours and logs `cache.reload_failed`.
- **Unavailable, not empty.** With no good value, a missing dataset or a failed read answers 503 with an error body and no `Cache-Control`, never an empty or committed value.
- **A bad document is not served.** The repository parses the stored document with the dataset's schema; one that fails is logged at error with its revision and issues and not served, and the last good value within its window serves instead.
- **A dangling reference is left out.** An item whose reference no longer resolves is dropped from the response and logged once per revision, and the rest serves with status 200.

The TTL, the stale window and the dataset document's shape are shared by every reader; each reader keeps its own repository read and schema.

Amended 2026-10-19 by the OpenSpec change `move-editorial-datasets` (`openspec/changes/move-editorial-datasets/design.md`, D12):

- **A documented degraded answer may stand in for the 503.** A dataset whose capability documents an answer that serves without it may serve that answer instead of the 503, and logs the unavailable dataset at error. The festival layer sets are the case: `/map/config` serves the base map.
- **A derived cache keeps the bound or states its own.** A route that caches what it derives from a dataset either keys that cache by the dataset's revision, so a push still serves within a minute, or states its own longer bound in the dataset's capability.

### D7. `check --prod` before a schema change or a removed identity

A deploy restarts every replica with an empty cache, so the stale window does not cover a schema the new code rejects. Before merging a change that tightens a dataset's schema or removes an identity a dataset may reference, run `npm run data -- check --prod` from the new checkout, and push a fixed dataset first if it reports an issue.

### D8. What stays in code

Code, not datasets, holds: the identities of D2; the schemas, rules and readers; the response shapes (`.wire`); and data written by another repository, whose writer owns its shape (ADR 0010 D13). Data a poller writes from an upstream stays the poller's (ADR 0012 D1).

## Consequences

- **An edit needs no deploy and cannot fail a boot.** A bad edit is refused at push; a document that slips past serves the last good value or answers 503 on its own route, and the other routes keep serving.
- **ADR 0010 D5 no longer covers moved data.** A committed config file still fails the boot; a dataset is validated at push and parsed and left out at read.
- **ADR 0010 D13's scripts row is not used for datasets.** The tool loads the server's compiled schemas and rules, so no hand-written validator or equivalence spec mirrors them.
- **A schema change can strand stored data.** D7's check is a manual step for now; running it inside the deploy is an open question of the change.
- **Atlas reads grow by one `findOne` per dataset per replica per minute while the dataset's route is requested**, estimated in the change's design (D8).
- **Polling roles read datasets too.** A dataset that a poller's work depends on (the bus schedule content the shuttle ETA pollers plan runs with) is read in `poller` and `combined` as in `api`, under the same contract. Amended 2026-10-19 by the OpenSpec change `move-editorial-datasets` (D12).
- **Production data is edited from a laptop with `MONGO_URL`.** A database user scoped to the content database is an open question of the change.
