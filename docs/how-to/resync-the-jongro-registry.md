---
title: Resync the Jongro Registry
type: how-to
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-10-17
audience: internal
---

# Resync the Jongro Registry

> What to do when the Jongro station registry holds a stop list change it will not apply on its own, or a route's document is missing: read the change from its log, check it against TOPIS, and write it with a guarded update on `jongro_routes`.

## Overview

Each Jongro route's stations live in one `jongro_routes` document in `bus_campus` (`_id` is the route id, `jongro07`). The poller compares every tick's arrival list with it and applies a change by itself at the third identical tick ([bus architecture](../explanation/bus-architecture.md), "Invariants"). Two cases need a person:

| Log line (level) | Meaning | What serves meanwhile |
| --- | --- | --- |
| `bus.jongro.registry_change_held` (error) | TOPIS answered a list three ticks in a row that changes more than 30% of the stops | The stored list, as before the change |
| `bus.jongro.registry_missing` (error), `JONGRO_REGISTRY_UNAVAILABLE` 503s, `poller.failing` for `jongro-<code>` | A route's document is gone | Nothing for that route: its realtime screen, `/bus/config` and the ui transit routes answer 503 |

An applied change logs `bus.jongro.registry_synced` (warn) with `fromVersion`, `toVersion` and the stops added, removed, moved and renamed. It needs no action.

## Prerequisites

- (An operations detail is left out of the public history.)
- Write access to the production Atlas cluster with `mongosh`. The `_dev` databases share that cluster: check the database name before every write.
- `SEOUL_BUS_SERVICE_KEY` (Doppler `backend/prd_server`, never printed) to ask TOPIS yourself.

## Steps

### A held change

1. Find the line in Loki: `{container=~"skkuverse-poller.*"} | json | event="bus.jongro.registry_change_held"`. It carries `code`, `fromVersion`, `toVersion`, `observed` (the whole list TOPIS answered, in ord order) and the `added`, `removed`, `moved` and `renamed` stops. It is logged once per distinct list, so a quiet log does not mean the list stopped.
2. Check the list against TOPIS: `getStaionByRoute?busRouteId=<busRouteId>` (the ids are in `src/bus/jongro-routes.json`) and the operator's notice. A list that is another route's, or that drops most stops, is a bad answer: do nothing, and the poller keeps the stored list.
3. For a real reroute, write it. Use the `observed` list as it is, and the turnaround stop the position rows name (`trnstnid` of `getBusPosByRouteSt`), or the stored one when no bus runs:

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
5. If the committed snapshot (`src/bus/registry/jongro-stations.seed.json`) is now far from the stored list, update it in a pull request too: it only seeds a missing document, but a stale one makes a future reseed serve old stations until the sync catches up.

### A missing document

1. Restart the api replicas or the poller (a deploy does it): every boot seeds a missing route from the committed snapshot and logs `bus.jongro.registry_seeded` (warn). It never overwrites a stored route.
2. If the snapshot is known to be stale, apply the current list afterwards as in "A held change", step 3, with the seeded document's `stationsVersion` in the filter.

## Troubleshooting

- **`bus.jongro.registry_sync_conflict` (warn).** The stored version changed between the poller's read and its write, usually a hand write as above. Nothing was written; the next ticks compare against the new document.
- **`bus.jongro.registry_unmatched_transfer` (warn).** A `transferLinesByArsId` entry in `src/bus/jongro-routes.json` names an ARS number no stored station has, so that stop's subway badges are gone. Fix the key in a pull request after a renumbered stop.
- **The realtime screen and `/bus/config` disagree on `stationsVersion`.** `/bus/config` is cached by clients for up to five minutes (`private, max-age=300`); this clears by itself.

## Related

- [Bus architecture](../explanation/bus-architecture.md): the registry, its glossary terms and invariants
- `openspec/changes/improve-jongro-realtime/design.md`, decisions D6 to D10
