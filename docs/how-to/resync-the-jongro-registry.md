---
title: Resync the Jongro Registry
type: how-to
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-10-27
audience: internal
---

# Resync the Jongro Registry

> What to do when the Jongro station registry holds a stop list change it will not apply on its own, or a route's document is missing: read the change from its log, check it against TOPIS, and write it with a guarded update on `jongro_routes`.

## Overview

Each Jongro route's stations live in one `jongro_routes` document in `bus_campus` (`_id` is the route id, `jongro07`). The poller compares every tick's arrival list with it and applies a change by itself at the third identical tick ([bus architecture](../explanation/bus-architecture.md), "Invariants"). No snapshot is committed: a route with no document is created by the poller from TOPIS, at the third identical tick that names a turnaround stop on that list, so a fresh database fills itself while buses run and stays empty overnight. Two cases need a person:

| Log line (level) | Meaning | What serves meanwhile |
| --- | --- | --- |
| `bus.jongro.registry_change_held` (error) | TOPIS answered a list three ticks in a row that changes more than 30% of the stops | The stored list, as before the change |
| `bus.jongro.registry_missing` (error), `JONGRO_REGISTRY_UNAVAILABLE` 503s | A route's document is gone, and no bus has run since to bootstrap it | Nothing for that route: its realtime screen, `/bus/config` and the ui transit routes answer 503 |

An applied change logs `bus.jongro.registry_synced` (warn) with `fromVersion`, `toVersion` and the stops added, removed, moved and renamed; a bootstrapped route logs `bus.jongro.registry_bootstrapped` (warn) with its `stationsVersion`, `turnaroundTopisId` and `stationCount`. Neither needs action.

## Prerequisites

- Read access to the production logs (Grafana Loki).
- Write access to the production Atlas cluster with `mongosh`. The `_dev` databases share that cluster: check the database name before every write.
- `SEOUL_BUS_SERVICE_KEY` (Doppler `backend/prd_server`, never printed) to ask TOPIS yourself.

## Steps

### A held change

1. Find the line in Loki: `{container=~"skkuverse-poller.*"} | json | event="bus.jongro.registry_change_held"`. It carries `code`, `fromVersion`, `toVersion`, `observed` (the whole list TOPIS answered, in ord order) and the `added`, `removed`, `moved` and `renamed` stops. It is logged once per distinct list, so a quiet log does not mean the list stopped.
2. Check the list against TOPIS: `getStaionByRoute?busRouteId=<busRouteId>` (the ids are `JONGRO_ROUTES` in `src/bus/bus.constants.ts`) and the operator's notice. A list that is another route's, or that drops most stops, is a bad answer: do nothing, and the poller keeps the stored list.
3. For a real reroute, write it. Use the `observed` list as it is, and the turnaround stop the position rows name (`trnstnid` of `getBusPosByRtid`), or the stored one when no bus runs:

   ```js
   // mongosh, against bus_campus (never bus_campus_dev for production)
   const observed = [/* the observed list from the log: { topisId, arsId, stationName } */];
   db.jongro_routes.updateOne(
     { _id: "jongro07", stationsVersion: "<fromVersion from the log>" },
     { $set: {
         stations: observed.map((s, i) => ({ ...s, sequence: i + 1 })),
         turnaroundTopisId: "<turnaround stop id>",
         stationsVersion: "<toVersion from the log>",
         syncedAt: new Date(),
     } },
   );
   ```

   The filter on `stationsVersion` makes the write a no-op if the poller or someone else changed the document first: `matchedCount: 0` means read it again. Use the log's `toVersion` only when the turnaround stop is the one the log's list was observed with; otherwise leave the version to the next sync (step 4).
4. Wait a minute. Every replica reads the document again within 30 s; the poller then sees TOPIS answer the stored list, so it logs nothing more. If the version you wrote differs from what the poller computes, its next three ticks apply its own, which logs `bus.jongro.registry_synced` with an empty diff.

### A missing document

While buses run, wait: the poller inserts the route within three ticks (about 75 s) and logs `bus.jongro.registry_bootstrapped`. Its tick writes no `bus_cache` entry for the route until then, and rejects with `BusRegistryBootstrappingError`; the inserting tick resolves, so a daytime bootstrap stays under the three failures that declare `poller.failing`. Overnight no position row names a turnaround stop, so nothing is counted until the first bus runs: `jongro-<code>` is declared failing and logs `poller.recovered` at the insert.

To serve the route before then, insert it by hand:

1. Take the stop list from `getArrInfoByRouteAllList?busRouteId=<busRouteId>` (each row's `stId`, `arsId`, `stNm`, ordered by `staOrd`) and the turnaround stop from the last trusted list (a `bus.jongro.registry_synced` or `registry_bootstrapped` line in Loki) or from `getStaionByRoute` (the station whose `transYn` is `Y`).
2. Insert it with `$setOnInsert`, so the write never replaces a document the poller stored first:

   ```js
   // mongosh, against bus_campus (never bus_campus_dev for production)
   const stations = [/* { topisId, arsId, stationName } in ord order */];
   db.jongro_routes.updateOne(
     { _id: "jongro07" },
     { $setOnInsert: {
         stations: stations.map((s, i) => ({ ...s, sequence: i + 1 })),
         turnaroundTopisId: "<turnaround stop id>",
         stationsVersion: "manual",
         syncedAt: new Date(),
     } },
     { upsert: true },
   );
   ```

   `upsertedCount: 0` means a document was already there: read it instead. Every replica serves the route within 30 s. Once buses run, the poller computes its own version for the same list and applies it at the third tick, logging `bus.jongro.registry_synced` with an empty diff.

## Troubleshooting

- **`bus.jongro.registry_sync_conflict` (warn).** The stored version changed between the poller's read and its write, usually a hand write as above. Nothing was written; the next ticks compare against the new document.
- **`bus.jongro.registry_bootstrap_conflict` (warn).** A document appeared between the poller's third observation and its insert, usually a hand insert. The stored one is kept.
- **`bus.jongro.registry_unmatched_transfer` (warn, once per route, ARS number and revision).** A `transferLinesByArsId` entry in the stored `jongro-route-attributes` names an ARS number no stored station has, so that stop's subway badges are gone. After a renumbered stop, fix the key with a push, no deploy ([edit-runtime-data.md](edit-runtime-data.md#edit-a-jongro-routes-card-or-seat-count)).
- **The realtime screen and `/bus/config` disagree on `stationsVersion`.** `/bus/config` is cached by clients for up to five minutes (`private, max-age=300`); this clears by itself.

## Related

- [Bus architecture](../explanation/bus-architecture.md): the registry, its glossary terms and invariants
- [ADR 0014](../decisions/0014-jongro-realtime-from-topis.md), D4: why the sync follows the arrival list
- [ADR 0012](../decisions/0012-runtime-roles.md), D3: no process seeds at boot; the poller bootstraps a missing route
