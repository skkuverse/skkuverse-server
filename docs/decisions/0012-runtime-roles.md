---
title: Runtime Roles — Pollers Write, Api Replicas Read
type: adr
status: draft
owner: zoyoong124@gmail.com
last-updated: 2026-10-19
audience: internal
---

# 0012. Runtime Roles — Pollers Write, Api Replicas Read

> What each `ROLE` (`poller`, `api`, `combined`) may do: who calls upstream APIs, who writes MongoDB, what an api replica may do at boot and while serving, which configuration each role needs, and how soon a write by one process reaches the others. Read it before you add a poller, a boot hook, a required variable or a cache in front of data another process writes.

## Status

Draft — 2026-10-19. The decisions come from the OpenSpec change `isolate-api-from-pollers` (`openspec/changes/isolate-api-from-pollers/design.md`); its `tasks.md` is the record of which rules hold in code so far. The ADR becomes accepted when the change is archived.

It supersedes one consequence drawn from [ADR 0009](0009-multi-origin-active-active.md): that every role, api replicas included, seeds the Jongro registry and route lines at boot, so that a standby host running api replicas without a poller could serve on its first deploy (`improve-jongro-realtime` D7). ADR 0009's second host was removed on 2026-10-03, and a poller ships in every deploy.

## Context

- One image boots three ways, picked by `ROLE` (`src/main.ts`): `poller` runs every background poller and binds no port, `api` serves HTTP and runs no poller, and `combined` (the local default) does both. Production runs one poller container and several api replicas against one Atlas cluster.
- `config.runsPollers()` (`src/infra/config.ts`) was the only role test, and it gated only the poller timers. Every module, repository and `onModuleInit` hook loaded in every role. So:
  - some reads fell back to what a poller held in the same process's memory, which only `combined` has, so a local run could answer differently from production;
  - api replicas wrote at boot: snapshot seeds into `jongro_routes` and `jongro_route_paths`, and index DDL on collections other processes write;
  - an api replica needed the pollers' upstream keys to boot, and a runtime switch meant for a poller (`SUBWAY`) also changed how api read;
  - a write by a script or by the poller reached the api replicas only after a cache TTL of up to an hour, or after a restart.
- Later changes move the remaining committed runtime data (layouts, banners, mini apps, stops, timetables) into MongoDB. They rely on one guarantee: the poller or a script writes, and every replica reads the same thing soon after.

## Decision

### D1. Pollers write; api replicas read

A process that runs pollers (`poller`, `combined`) calls the upstream data APIs (HSSC, TOPIS, the Seoul subway API and train map, NAVER, TMAP, data.go.kr, the SKKU campus map) and writes what it learns to MongoDB. An api replica reads MongoDB through caches and calls none of those APIs, at boot or while serving. Scripts (`npm run schedule` and the other data scripts) and other repositories (skkuverse-crawler) are writers too; api reads what they write the same way.

A read that serves a client takes its data from MongoDB only. It never falls back to a value a poller holds in the same process, so `combined` and `api` answer identically for the same stored data. State a poller keeps from one tick to the next (an HSSC bus's first sighting, a Jongro vehicle's last observation, a pending registry change) stays in the poller's memory, because the poller computes with it; it reaches clients only through what the poller writes.

### D2. Five request-scoped upstream calls stay in api

An api replica calls an upstream only on behalf of the request it is serving, and only these:

| Call | Where |
| --- | --- |
| The notice attachment proxy | `src/notices/attachment/` |
| The notice search overview (skkuverse-ai) | `src/notices/overview/` |
| The FCM Cloud Function, for notice dispatch | `src/infra/fcm.ts`, called from `src/notices/dispatch/` |
| The FCM Cloud Function, for mini app push | `src/miniapps/notifications/` |
| Firebase ID token verification | (A perimeter detail is left out of the public history.) |

The first-party mini app manifest fetch (`src/miniapps/catalog/`) is a temporary sixth: it moves to a poller with the mini app registry. Any other upstream call belongs in a poller.

### D3. No writes at boot from api

An api replica inserts, updates and deletes no document and creates no index or collection while it boots. Each repository keeps declaring its indexes next to the query they serve (`.claude/rules/architecture.md`), and `ensureIndexesAtBoot` (`src/infra/mongo.ts`) runs them only where pollers run. The poller ships in every deploy, so the indexes exist before an api replica's first write (`sent_notifications`, written by the dispatch route).

A collection that must hold a document before anything can serve it gets that document from a writer: the Jongro poller bootstraps a missing registry route from TOPIS, and the daily route-line sync writes a missing line. Nothing is seeded from a committed snapshot.

### D4. Required configuration follows the role

Each required value names the roles that need it:

- **poller**: the upstream keys only pollers use (HSSC, TOPIS, NAVER Directions, TMAP, data.go.kr, the Seoul subway API).
- **api**: what only serving uses (the AI API, the NAVER map style, the internal dispatch token, the notices service start date).
- **all**: everything both use (MongoDB, the FCM function, Sentry).

A process exits at boot, naming each missing value its role needs, and ignores the values its role does not. A value read in a role that does not require it throws at its first read, so a wrongly scoped value fails loudly instead of becoming `undefined` in a URL. One rendered `.env` still feeds every container; the scope is about what boot requires, not what is present.

### D5. Runtime switches gate writers only

A switch that turns off a poller (`SUBWAY`, `SHUTTLE_ETA`, `BUILDING_SYNC`) stops that poller's upstream calls and writes. It does not change what an api replica reads: with nothing fresh written, a read serves what its own rules serve for missing data, such as the subway timetable alone.

### D6. Freshness by TTL, not by cross-process signals

A process sees another process's write when its cache entry expires. No writer notifies the readers, and nothing restarts them. Each cache below holds its bound because, once its TTL has passed, a read waits for the reload instead of answering from the expired value (`serveStale: "on-reload-failure"` in `src/infra/cached-loader.ts`):

| Data | Written by | Bound |
| --- | --- | --- |
| Bus schedules and overrides | `npm run schedule` and the override scripts | 1 minute |
| The Jongro registry | The Jongro poller | 1 minute or less |
| Stored public holidays | The holidays poller | 10 minutes |
| Jongro route lines | The route-line poller | 10 minutes |
| Buildings | The building sync | 5 minutes |

Reference data that a database outage must not take down (bus schedules, overrides, stored holidays, route lines) keeps a stale window that covers only a failed reload: it serves the last good value for at least an hour and logs `cache.reload_failed`. A cache whose stale window also answers while a reload runs (the default mode) is late by up to TTL plus one reload, and states its bound that way. A writer may still clear its own process's cache after a write, so the poller sees its own write at once.

## Consequences

- **`combined` is an honest local copy of production.** A stopped or failing poller shows locally as it does in production: empty realtime data, not the process's memory.
- **api replicas boot and scale without the pollers' keys or their quotas**, and a failing upstream cannot slow an api boot.
- **A fresh `_dev` or `_test` database shows no Jongro data until the poller has observed TOPIS with buses running**, and no route line until the first daily sync. Production and both existing `_dev` databases hold every document already. Route tests use fakes.
- **An index exists only after a poller boots.** If the poller never boots, an api replica serves without the indexes it relies on; the readiness check and the deploy cover that case.
- **Shorter TTLs cost reads.** The schedule week cache at one minute adds a few reads per second across all processes (estimated in the change's design, D7); if Atlas ops/s shows a step, the TTL and the bound rise together.
- **Exactly one poller stays an assumption.** Daily caps, the registry's pending counts and the freezing of shuttle estimates rely on it; a second poller needs leader election first (ADR 0009, Phase B).
- **The Hyehwa station route is deleted, not ported** (`GET /bus/station/:stationId`, its poller and `API_STATION_HEWA`). The app does not call it, and its upstream answered "no result" in every recorded sample.
