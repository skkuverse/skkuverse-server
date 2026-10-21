---
title: Edit Bus Stops
type: how-to
status: draft
owner: zoyoong124@gmail.com
last-updated: 2026-10-22
audience: internal
---

# Edit Bus Stops

> How to change a shuttle stop, its photo, street view or map guide, a stop sequence's labels, notes or length, or an HSSC station label, with `npm run data` and no deploy: pull `bus-stops`, edit, push to `_dev`, then to production, and roll back.

## Overview

The `bus-stops` dataset holds every local stop the server serves ([bus architecture](../explanation/bus-architecture.md)): the commute and campus shuttle stops, the HSSC stops, the shuttle stop sequences, and the HSSC line. It is one document of the content database, edited as a whole with `npm run data` ([edit-runtime-data.md](edit-runtime-data.md)). A push reaches `/bus/config`, its groups, the ui transit routes, the smart schedule's estimates and both estimate pollers within a minute, ETags included.

```text
{ "stops":     [ { "id", "name", "detail"?, "coords"?, "photo"?, "panorama"?, "guide"?, "subwayStationId"?, "arsIds"? } ],
  "sequences": { "<serviceId>": { "<routeType>": [ { "stopId" | "label", "action", "timing", "note"?, "detail"? } ] } },
  "hssc":      { "stations": [ { "stopId", "name", "subtitle", "isFirstStation", "isLastStation", "isRotationStation", "transferLines" } ] },
  "topis"?:    { "<ARS number>": { "name"?: { "en"?, "zh"? }, "subwayStationId"? } } }
```

What stays in code, and needs a deploy to change: the service ids and which route types get arrival estimates (`SERVICE_CONFIG` in `src/bus/bus.constants.ts`), the travel strategies (`LANE_STRATEGIES`), the HSSC position count (`HSSC_POSITION_COUNT`) and how the HSSC API's stop names map to positions (`src/bus/realtime/hssc/`). Jongno stops are TOPIS's and are never stored here.

| Part | Rules a push checks |
| --- | --- |
| A stop's `id` | Lower-case words of `a-z` and `0-9` joined by single hyphens, unique, never starting with `seoul-` (a TOPIS pole's derived id). An id on the wire never changes: clients hold it |
| `name`, `detail`, a label or note | `ko` required, `en` and `zh` never blank when present |
| `coords` | Inside South Korea; required for a stop of a sequence that gets estimates, and for a stop with a `guide` |
| `photo` | (A collector detail is left out of the public history.) |
| `panorama` | A 22-character NAVER panorama id, integer `pan` (−180 to 180), `tilt` (−90 to 90) and `fov` (25 to 80) |
| `guide` | Subway exit places, and walks of at most 500 m that start or end at the stop as the sequences use it |
| `subwayStationId` | A station slug the subway module serves |
| A sequence | At least two stops, the first boarding, one alighting; a stop once per sequence; an estimated one with its first stop scheduled and at most seven stops |
| `hssc.stations` | Exactly `HSSC_POSITION_COUNT` positions in wire order, only the first flagged first and the last flagged last, each `stopId` a stop of this dataset or `null`, no stop named twice |
| `arsIds` | Five-digit ARS numbers, each claimed by one stop only |
| A sequence against the stored timetables | Every entry of its service and route type in the target's `bus_campus.bus_schedules` (`_dev` without `--prod`) has one `stopTimes` time per stop, `null` only at an estimated stop; a refusal names the service, the route type and each entry time |

A sequence and its timetable are written by two tools, and each refuses a length the other side does not match: `npm run data -- push bus-stops` checks against the stored timetables, and `npm run schedule` checks a timetable file against the stored `bus-stops`, each in the database it targets. A sequence-length change pushes the sequence with `--against` the new timetable file, then applies that file at once ([below](#change-a-sequences-length)).

> [!WARNING]
> Push from a checkout at the deployed `main`. The tool checks with your checkout's compiled code, and every replica checks the stored revision again with the deployed code when it reads it. A revision the deployed code refuses (one a newer or older checkout accepts) is not served: each replica logs `bus.stops.invalid` once and keeps its last good revision for 24 hours, then `/bus/config` and the shuttle groups answer `503 BUS_STOPS_UNAVAILABLE`; a replica that restarts in that time answers the 503 at once. `bus.stops.invalid` is the signal: roll back to the last good revision ([below](#roll-back)).

## Prerequisites

- What [edit-runtime-data.md](edit-runtime-data.md) needs: a `.env` from `npm run env:pull`, a `git config user.email` or `--by`, and this checkout.
- For a new photo, the uploaded `media.skkuverse.com` URLs.

## Steps

### Edit a stop, photo, guide or HSSC label

1. Pull `_dev` and edit `data` in `.data/dev/bus-stops.json`, for a stop's photo:

   ```bash
   npm run data -- pull bus-stops
   ```

   ```json
   { "id": "jeongja-exit3", "name": { "ko": "정자역 3번 출구" }, "photo": { "original": "https://media.skkuverse.com/stops/jeongja-exit3-v2.jpg" } }
   ```

   An HSSC station's label is its `name` (Korean) and `subtitle` (English, served in every language); its stop's own `name` is what a stop page will show.

2. Preview, push to `_dev`, and check the stored revision:

   ```bash
   npm run data -- push bus-stops --dry-run
   npm run data -- push bus-stops --note "jeongja-exit3 photo"
   npm run data -- check bus-stops
   ```

3. Read `/bus/config/commute` against the `_dev` data (a local `npm run dev`, [test-the-app-against-a-local-server.md](test-the-app-against-a-local-server.md)).
4. Make the same edit in production and push:

   ```bash
   npm run data -- pull bus-stops --prod
   # edit .data/prod/bus-stops.json
   npm run data -- push bus-stops --prod --note "jeongja-exit3 photo"
   npm run data -- check bus-stops --prod
   ```

### Change a sequence's length

Adding or removing a stop of a sequence changes the length of every `stopTimes` of its service and route type, which `npm run schedule` writes from `scripts/data/campus-schedule.json` or `scripts/data/commute-schedule.json`. Each writer refuses while the other side is old, so the sequence goes first, checked against the new timetable file:

1. Edit the sequence in `.data/dev/bus-stops.json` and the timetable file: one more (or one fewer) time in every `stopTimes` of that service and route type, `null` where the new stop is estimated.
2. Push the sequence against the file. The tool checks against the file's entries in place of the stored ones of the same service and pattern, and prints the command that applies the file:

   ```bash
   npm run data -- push bus-stops --against scripts/data/commute-schedule.json --note "gangnam down: Nonhyeon stop"
   ```

3. Apply the timetable at once with the printed command, here `npm run schedule -- --file scripts/data/commute-schedule.json`. Between the two writes the smart view serves the old stop times against the new stops, and the stored estimates of that sequence are dropped and fetched again.
4. Check both sides: `npm run data -- check bus-stops` and `npm run schedule -- --file scripts/data/commute-schedule.json --check`.
5. Repeat with `--prod` on both commands (`push bus-stops --prod --against …`, then the printed `npm run schedule … --prod`).

### Roll back

```bash
npm run data -- history bus-stops --prod
npm run data -- rollback bus-stops <revision> --prod
```

A rollback runs the push checks and reaches every route within a minute, like a push. A rollback that changes a sequence's length is refused while the stored timetable fits the newer one: apply the matching timetable file as in [Change a sequence's length](#change-a-sequences-length).

## Verify

- `npm run data -- check bus-stops --prod` exits `0`, and after a length change `npm run schedule -- --file <timetable file> --check --prod` does too.
- Within a minute, `/bus/config/<group>` answers the new body with a new ETag, and an untouched group keeps its ETag.
- (An operations detail is left out of the public history.)

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| The push is refused at `stops.<n>.id` | The id breaks the grammar or starts with `seoul-` | Pick a slug; never rename a served one |
| The push is refused at `hssc.stations` | Not exactly `HSSC_POSITION_COUNT` positions | The count is code: change it there, with the HSSC API matching, first |
| The push is refused naming a lane strategy | `LANE_STRATEGIES` sets one for a sequence the data drops | Keep the sequence, or remove the strategy in code and deploy first |
| `/bus/config` answers `503 BUS_STOPS_UNAVAILABLE` | A replica has never read a good `bus-stops` (missing, invalid or unreadable) | `npm run data -- check bus-stops --prod`; roll back to the last good revision |
| `bus.stops.invalid` in the logs after a push the tool accepted | The checkout you pushed from is not the deployed code, which refuses the revision | Roll back to the last good revision now, within the 24 hours, then push again from a checkout at the deployed `main` |
| The push is refused at `sequences.<service>.<route type>`, "timetable entries do not fit this sequence" | The stored `stopTimes` of that service and route type have the sequence's old length | A length change: push `--against` the new timetable file, then apply it ([above](#change-a-sequences-length)) |
| `npm run schedule` fails with `MISMATCH` lines | The file's `stopTimes` do not fit the target's stored `bus-stops` sequences | Fix the file, or push the new sequence first with `--against` this file |
| `npm run schedule` fails with `bus-stops is not stored` | The target content database holds no `bus-stops` | Push `bus-stops` to that target first |
