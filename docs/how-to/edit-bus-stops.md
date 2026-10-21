---
title: Edit Bus Stops
type: how-to
status: draft
owner: zoyoong124@gmail.com
last-updated: 2026-10-22
audience: internal
---

# Edit Bus Stops

> How to change a shuttle stop, its photo, street view or map guide, a stop sequence's labels and notes, or an HSSC station label, with `npm run data` and no deploy: pull `bus-stops`, edit, push to `_dev`, then to production, and roll back.

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

A sequence's length must match its timetable's `stopTimes` (`scripts/data/*-schedule.json`, written by `npm run schedule`). Do not add or remove a sequence stop here until the timetable for it is ready.

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

### Roll back

```bash
npm run data -- history bus-stops --prod
npm run data -- rollback bus-stops <revision> --prod
```

A rollback runs the push checks and reaches every route within a minute, like a push.

## Verify

- `npm run data -- check bus-stops --prod` exits `0`.
- Within a minute, `/bus/config/<group>` answers the new body with a new ETag, and an untouched group keeps its ETag.
- (An operations detail is left out of the public history.)

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| The push is refused at `stops.<n>.id` | The id breaks the grammar or starts with `seoul-` | Pick a slug; never rename a served one |
| The push is refused at `hssc.stations` | Not exactly `HSSC_POSITION_COUNT` positions | The count is code: change it there, with the HSSC API matching, first |
| The push is refused naming a lane strategy | `LANE_STRATEGIES` sets one for a sequence the data drops | Keep the sequence, or remove the strategy in code and deploy first |
| `/bus/config` answers `503 BUS_STOPS_UNAVAILABLE` | A replica has never read a good `bus-stops` (missing, invalid or unreadable) | `npm run data -- check bus-stops --prod`; roll back to the last good revision |
