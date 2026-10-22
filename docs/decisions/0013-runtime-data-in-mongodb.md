---
title: Runtime Data Lives in MongoDB
type: adr
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-10-22
audience: internal
---

# 0013. Runtime Data Lives in MongoDB

> Where the editorial and reference data the server serves is kept once it leaves the repository: datasets in one content database, edited only with `npm run data`, checked at push with the server's own compiled schemas and rules, and read by every replica within a stated bound. Read it before you move a committed data file to MongoDB, change a dataset's schema, or remove an identity a dataset may reference. Accepted 2026-10-19 (PR #289, #290); how to edit one: [how-to/edit-runtime-data.md](../how-to/edit-runtime-data.md).

## Context

- Editorial and reference data (layouts, banners, the mini-app registry, timetables, stop catalogs) was committed JSON: every edit a pull request, a review and a production deploy, and a bad edit failed the boot of every replica.
- [ADR 0012](0012-runtime-roles.md) made "a writer stores it, every replica reads it within a bound" hold for data in MongoDB.
- Scripts are CommonJS outside `tsconfig`; hand-written validators that mirror a server schema are covered only by the inputs an equivalence spec samples.
- A layout names identities other data owns (a home tile names a mini app). A deploy can remove such an identity while stored data still names it, and no push sees that.

## Decision

### D1. Datasets are the source of truth

A dataset is one document `{ _id: <dataset>, revision, data, updatedAt, updatedBy }` in the `datasets` collection of the content database (`MONGO_CONTENT_DB_NAME`, scope `all`, with the usual `_dev` and `_test` suffixes); `data` is exactly what the server's schema parses. It stays one document while it is read whole, edited as one unit and well under 1 MB. A dataset read one entity at a time, written entity by entity, or too large becomes **parted**: its `datasets` document is the header, and its `data` a manifest naming each part by key and a content-derived id; each part is one immutable `dataset_parts` document, read by `_id`.

One content database, not each module's: ui and app-config own no database, one history and one place resolve every cross-dataset reference, and a tool credential can be scoped to it alone. `bus_campus` was rejected: it holds the poller's hot collections.

- A family of like items is one dataset holding an array: every festival's layer set is one `map-layer-sets` (about 8 KB a festival, one or two a year; the catalog names datasets statically). Revisit when concurrent edits conflict.
- SKKU's rest days are the `skku-rest-days` dataset, not `bus_overrides` documents: an override is one service's exact date, unique on `(serviceId, date)`, so a yearly rest day would be a document per year per service, and a rest day ranks with public holidays, below an override.
- Rejected for parts: ids versioned by revision (every revision rewrites every part: 265 MB of timetables at 50 kept revisions), a part collection per dataset, and GridFS or one blob (no table read or parsed alone).

Once a dataset is stored, the repository holds no copy of it: no committed file, no fallback in the image.

### D2. Identities stay in code

What the code branches on stays in code: route ids, service ids, enums, the origins in `src/infra/origins.ts` (who owns each first-party origin included: a push must agree with it, and a read that does not is logged), UI-label translations and the hash-locked notices contract files. A dataset holds the data that names those identities, never the identities. Where the line falls, per dataset:

- Mini apps: the registry is the `miniapps` dataset; the ui datasets reference it as a dataset, resolved against the copy in the database a push targets.
- Subway: lines, stations and platforms with their names, colors and markers stay in code; platform directions and station neighbors are `subway-topology`.
- Jongno: route ids stay in code; each route's attributes (color, icon, refresh interval, seat count, transfer lines) are `jongro-route-attributes`.
- Bus lanes: the strategies and lane hours stay in code, since they decide which estimate model a run gets; the corridor geometry is `bus-lane-corridor`.
- Stops: a Seoul TOPIS pole's id (`seoul-<arsId>`) is derived from the stored Jongno registry at read and never stored. The local stops, the shuttle sequences and the HSSC line's labels and stop ids are `bus-stops`. The HSSC line's position count, upstream name matching and turnaround stay in code, since the HSSC poller places buses by them, and the dataset's line must match the count.

### D3. The tool is the only writer

`npm run data` is the only writer of the content database: the server only reads it, and no admin API or app edit writes it. The tool targets `_dev` unless `--prod` is given, prints the database and the diff and asks before a production write, refuses a working file pulled from the other target, and never prints `MONGO_URL`.

A generator (`scripts/subway-timetable/convert.py`, `scripts/build-bus-lane-corridor.js`) writes files into a pulled working directory for the tool to push, never MongoDB: it would restate the schema, bypass the history, the optimistic check and the production confirmation, and need `MONGO_URL` and a driver.

### D4. Every version is kept, and a push is based on one

Every push, rollback and copy records the stored version in `dataset_revisions`; a bounded number of recent revisions is kept (`RETAINED_REVISIONS`, `scripts/lib/datasets/store.js`) and the current one is never pruned. A part is kept while a retained revision names it, so a rollback finds every part it restores. A rollback stores an earlier revision's data as a new revision; history is never rewritten.

A push names the revision it was pulled at and is stored only if the dataset is still there, in one conditional update; otherwise it writes nothing and reports who holds the current revision. There is no transaction (it would need a replica set in the round-trip tests, which run a standalone `mongod`): the dataset is written before its history entry, so only the winner writes history, and a run that finds the current revision without an entry records it first.

### D5. Validation is the server's compiled code; references are declared per dataset

The tool runs over `dist/`, built from the same checkout first, so a push is checked by the zod schema the server's repository parses with and by the same pure `.rules` functions, never by a copy. Each dataset's catalog entry (`scripts/lib/datasets/catalog.js`) declares its schema, the issues a schema cannot hold, the identities it references and those it holds, and any collection outside the content database its check reads (read from the environment the push targets, never the other: a `bus-stops` push reads that environment's `bus_schedules`, so a sequence and its timetable agree). A push runs all of it, plus the incoming references of every stored dataset that names it, and refuses on any issue. `check` runs the same checks on stored data and writes nothing.

The tool is a CommonJS entry, `scripts/data.js`, over `dist/`. Rejected: a TypeScript entry in `src/` (not a role file, breaks the `console` and `require()` bans, ships in the image); a separate `tools/` TypeScript project; `tsx` or `ts-node` (a new dependency); running it inside Jest like `contracts:export` (the network guard refuses Atlas).

### D6. The read contract

Every reader of a dataset, in every role that reads it (pollers included, such as the shuttle ETA and subway pollers), keeps the same contract (`src/shared/dataset.constants.ts`):

- **A bound on freshness.** A cached loader with a 60-second TTL and `serveStale: "on-reload-failure"`, so every replica serves a push within a minute while the database answers.
- **A stale window.** After a good read, a failed reload serves the last good value for 24 hours and logs `cache.reload_failed`: editorial data a day old is still correct to serve, and a 503 costs the screen.
- **Unavailable, not empty.** With no good value, a missing dataset or a failed read answers 503 with an error body and no `Cache-Control`, never an empty or committed value. A dataset whose module doc documents an answer that serves without it may serve that answer instead, and logs the unavailable dataset at error: `/map/config` serves the base map without the festival layer sets; `/bus/config` and the ui transit routes serve without the Jongno groups, while a Jongno group's own route answers 503.
- **A bad document is not served.** The repository parses the stored document with the dataset's schema; one that fails is logged at error with its revision and issues, and the last good value within its window serves.
- **A dangling reference is left out.** An item whose reference no longer resolves is dropped and logged once per revision, and the rest serves with 200.
- **A derived cache keeps the bound or states its own.** A cache of something derived from a dataset is keyed by the dataset's revision, or states its own longer bound in its module doc's Invariants. A cached ETag is keyed by the revision of every dataset its body is built from, or computed from the body, so a push to a dataset the route does not read leaves it alone.

### D7. `check --prod` before a schema change or a removed identity

A deploy restarts every replica with an empty cache, so the stale window does not cover a schema the new code rejects. Before merging a change that tightens a dataset's schema or removes an identity a dataset may reference, run `npm run data -- check --prod` from the new checkout, and push a fixed dataset first if it reports an issue.

### D8. What stays in code

Code holds the identities of D2, the schemas, rules and readers, the response shapes (`.wire`), and data another repository writes, whose writer owns its shape ([ADR 0010](0010-server-architecture.md) D13). Data a poller writes from an upstream stays the poller's (ADR 0012 D1).

## Consequences

- **An edit needs no deploy and cannot fail a boot.** A bad edit is refused at push; a document that slips past serves the last good value or answers 503 on its own route, and other routes keep serving.
- A committed config file still fails the boot (ADR 0010 D5); a dataset is validated at push and parsed at read instead, and needs no equivalence spec (ADR 0010 D13).
- **A schema change can strand stored data.** D7's check is manual. **Open:** running it inside the deploy.
- **Atlas reads grow by one `findOne` per dataset per replica per minute** while the dataset's route is requested.
- **Poller memory is read over hours.** Its `docker stats` figure is dominated by each tick's garbage (about 45 MB allocated per tick): compare the minimum `anon` of its cgroup's `memory.stat` over hours, never one reading.
- **Production data is edited from a laptop with `MONGO_URL`.** **Open:** a database user scoped to the content database.
