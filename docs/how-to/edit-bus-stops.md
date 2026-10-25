---
title: Edit Bus Stops
type: how-to
status: draft
owner: zoyoong124@gmail.com
last-updated: 2026-10-25
audience: internal
---

# Edit Bus Stops

> How to change a shuttle stop, its photo, street view or map guide, a stop sequence's labels, notes or length, or an HSSC station's label or drop-off-only flag, with `npm run data` and no deploy: pull `bus-stops`, edit, push to `_dev`, then to production, and roll back.

## Overview

The `bus-stops` dataset holds every local stop the server serves ([bus architecture](../explanation/bus-architecture.md)): the commute and campus shuttle stops, the HSSC stops, the shuttle stop sequences, and the HSSC line. It is one document of the content database, edited as a whole with `npm run data` ([edit-runtime-data.md](edit-runtime-data.md)). A push reaches `/bus/config`, its groups, the ui transit routes, the smart schedule's estimates and both estimate pollers within a minute, ETags included.

```text
{ "stops":     [ { "id", "name", "detail"?, "coords"?, "photo"?, "panorama"?, "guide"?, "subwayStationId"?, "arsIds"?, "topisIds"?, "campus"? } ],
  "sequences": { "<serviceId>": { "<routeType>": [ { "stopId" | "label", "action", "timing", "note"?, "detail"? } ] } },
  "hssc":      { "stations": [ { "stopId", "name", "subtitle"?, "isFirstStation", "isLastStation", "isRotationStation", "isAlightOnly"?, "transferLines" } ] },
  "topis"?:    { "<ARS number>": { "name"?: { "en"?, "zh"? }, "subwayStationId"? } },
  "stopAreas"?: [ { "id", "name", "stopIds" } ] }
```

What stays in code, and needs a deploy to change: the service ids and which route types get arrival estimates (`SERVICE_CONFIG` in `src/bus/bus.constants.ts`), the travel strategies (`LANE_STRATEGIES`), the HSSC position count (`HSSC_POSITION_COUNT`), the positions the shuttle passes through (`isHsscPassThrough` in `src/bus/bus.rules.ts`, 5 and 7) and how the HSSC API's stop names map to positions (`src/bus/realtime/hssc/`). Jongno stops are TOPIS's and are never stored here.

Every stop of a sequence or the HSSC line, and every Jongno pole, has a stop page, `GET /bus/stops/:stopId/arrivals` ([bus-stops-api.md](../reference/bus-stops-api.md)). What it shows, and where each part comes from:

| On the page | From |
| --- | --- |
| The stop's name, detail, photo, street view and subway link | The stop's record in this dataset, as `/bus/config` serves it, without its map guide |
| The stop's coordinates | The stop's `coords`; for a Jongno pole, or an aliased stop with none, the pole's on the stored route line |
| A Jongno pole's name and id | The stored registry station (its nine-digit station id, its Korean name): not this dataset. Its `seoul-<ARS number>` id is an alias that still answers its page |
| The routes and their order | The HSSC line's `stopId`s and the sequences' stops here, then the registry's poles, in `/bus/config`'s group order; an alias in `topisIds` or `arsIds` adds its pole's Jongno routes to the local stop |
| A shuttle entry's next runs | The stored timetable and estimates, through the smart schedule; boarding and drop-off stops alike |
| An HSSC entry's buses | `bus_cache`, as the HSSC realtime route serves them |

Every realtime station of `/bus/config` names its stop page as `stopId`, its last field: an HSSC position its `stopId` here, a Jongno station its pole's station id or the local stop aliasing it, and a position with none (the two non-stop 혜화동로터리 rows) no key ([bus-stops-api.md](../reference/bus-stops-api.md#stop-ids-on-the-realtime-stations)). A position with none is a pass-through: `/bus/config` serves it `isPassThrough: true` and the app shows "미정차" there, so a position's `stopId` is `null` exactly at the positions the code passes through (`isHsscPassThrough`), which the HSSC estimates never count as a stop; a push that leaves another position `null`, or names a stop at one of them, is refused.

The same stops, each once, make the stop list, `GET /bus/stops`, which the app's map draws as pins ([bus-stops-api.md](../reference/bus-stops-api.md#get-busstops)): a stop with no `coords` is listed with `coords: null` and gets its pin once a push gives it coordinates, and a stop's `campus` files it under a campus, `null` when left out (a Jongno pole and a stop aliasing one are `hssc` without it). The app's map, its stop pins and its nearest-stop camera open only a stop with coordinates, so a push refuses a stop without `coords` that the HSSC line or a sequence names or that has `arsIds` or `topisIds`, at `stops.<index>.coords`; a Jongno pole's coordinates come from its stored route line, which no push checks.

A push that changes a stop, a sequence or an alias reaches its page within a minute, and an alias the `stopId` of its pole's stations in each Jongro group, whose ETag changes with it. A slug renamed or removed answers `404` on its page, so never rename a served one: the app may hold it.

| Part | Rules a push checks |
| --- | --- |
| A stop's `id` | Lower-case words of `a-z` and `0-9` joined by single hyphens, unique, with at least one letter (a TOPIS pole's id is all digits) and never starting with `seoul-` (a pole's alias). An id on the wire never changes: clients hold it |
| `name`, `detail`, a label or note | `ko` required, `en` and `zh` never blank when present |
| `coords` | Inside South Korea; required for a stop the HSSC line or a sequence names or that has `arsIds` or `topisIds` (the app opens only a stop with coordinates, above), and for a stop with a `guide`. Only the push checks it: a stored revision without them still serves, with `coords: null` on the stop list |
| `photo` | (A collector detail is left out of the public history.) |
| `panorama` | A 22-character NAVER panorama id, integer `pan` (−180 to 180), `tilt` (−90 to 90) and `fov` (25 to 80) |
| `guide` | Subway exit places, and walks of at most 500 m that start or end at the stop as the sequences use it |
| `subwayStationId` | A station slug the subway module serves |
| A sequence | At least two stops, the first boarding, one alighting; a stop once per sequence; an estimated one with its first stop scheduled and at most seven stops |
| `hssc.stations` | Exactly `HSSC_POSITION_COUNT` positions in wire order, only the first flagged first and the last flagged last, `stopId` `null` at the pass-through positions (`isHsscPassThrough`: 5 and 7) and a stop of this dataset everywhere else, no stop named twice; `isAlightOnly`, when present, a boolean and never `true` at a position whose `stopId` is `null` |
| `arsIds` | Five-digit ARS numbers, each claimed by one stop only |
| `topisIds` | Nine-digit TOPIS station ids, each claimed by one stop only: for a pole TOPIS gives no ARS number (7800's 성균관대학교 `200000162` and `200000159`); it wins over another stop's `arsIds` claim on the same pole. A server older than the field refuses the key |
| `campus` | `hssc` or `nsc`, optional: `hssc` for a stop on the HSSC campus (the `hssc-` stops), `nsc` for one on the NSC campus (the `nsc-` stops), left out for a commute station stop, which serves neither campus. A server older than the field keeps it unread, so push it once the server that reads it is deployed |
| `stopAreas` | Each area's `id` a stop id, with at least one letter, that no stop or other area takes; its `name` as a stop's; at least two `stopIds`, each a stop of this dataset or a pole a listed TOPIS route serves in the target's stored registry, by its station id or its `seoul-<ARS number>` alias (a pole a local stop aliases is that stop), each stop in one area once, and each within 150 m of the members' centroid, a pole at its stored route line's coordinates. The id, the name and the member count are checked at read too; the rest needs the registry and the route lines, so only the push checks it ([below](#add-a-stop-area)) |
| A sequence against the stored timetables | Every entry of its service and route type in the target's `bus_campus.bus_schedules` (`_dev` without `--prod`) has one `stopTimes` time per stop, `null` only at an estimated stop; a refusal names the service, the route type and the first three entry times. A pattern that ended before today (KST) serves no date ahead: it is printed as `skipped` and not checked |

A sequence and its timetable are written by two tools, and each refuses a length the other side does not match: `npm run data -- push bus-stops` checks against the stored timetables, and `npm run schedule` checks a timetable file against the stored `bus-stops`, each in the database it targets. A sequence-length change pushes the sequence with `--against` the new timetable file, then applies that file at once ([below](#change-a-sequences-length)).

> [!WARNING]
> Push from a checkout at the deployed `main`. The tool checks with your checkout's compiled code, and every replica checks the stored revision again with the deployed code when it reads it. A revision the deployed code refuses (one a newer or older checkout accepts) is not served: each replica logs `bus.stops.invalid` once and keeps its last good revision for 24 hours, then `/bus/config`, the shuttle groups and the Jongro groups answer `503 BUS_STOPS_UNAVAILABLE`; a replica that restarts in that time answers the 503 at once. `bus.stops.invalid` is the signal: roll back to the last good revision ([below](#roll-back)).

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

   An HSSC station's label is its `name` (Korean); its stop's own `name` is what a stop page will show. Leave `subtitle` out of HSSC stations: the realtime screen fills the line under the name with the arrival, as it does for a Jongno station, and `/bus/config` serves `subtitle: null`. A `subtitle` you do store (English, served in every language) shows before the arrival on that line, and an empty one is refused at push.

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

### Flag an HSSC stop drop-off only

`isAlightOnly: true` on an HSSC position says riders may only get off there. Leave it out (or `false`) everywhere else; revisions stored before the field have none, which reads as `false`. `/bus/config` serves it as the station's `isAlightOnly` and the stop's page as its live entry's `action: "alight"` ([ADR 0019, D15](../decisions/0019-bus-live-api.md)). A pass-through position (`stopId: null`) is refused with it: no one gets off where the bus does not stop.

1. Pull `_dev` and add the flag to the two 하교-direction drop-off stops, keeping every other field:

   ```json
   { "stopId": "hssc-olympic-hall", "name": "올림픽기념국민생활관 [하차전용]", "isFirstStation": false, "isLastStation": false, "isRotationStation": false, "isAlightOnly": true, "transferLines": [] }
   ```

   Do the same at `hssc-hyehwa-post-office` (index 4).
2. Push to `_dev` with `--dry-run` first, then for real, and `check bus-stops`, as [above](#edit-a-stop-photo-guide-or-hssc-label). Within a minute `/bus/config/hssc` serves `isAlightOnly: true` at indexes 3 and 4 under a new ETag.
3. Make the same edit in production, from a checkout at the deployed `main` that has the field: an older one refuses the key.

Keep the `[하차전용]` (and `[미정차]`) markers in the names until the app OTA that reads `isAlightOnly`, `isPassThrough` and `action` is adopted: installed bundles still show only the name. Then remove them from each HSSC position's `name` in a later push; the stops' own names already carry none.

### Add an alias

(An operations detail is left out of the public history.)

1. Pull `_dev` and add the pole's station id to the local stop's `topisIds`, keeping every other field of its entry. Prefer the station id: it is never reused and survives a rename, while ARS numbers collide; the ARS number in `arsIds` still works:

   ```json
   { "id": "hssc-bus-lot", "…": "the entry's other fields, unchanged", "topisIds": ["100900221"] }
   ```

2. Push to `_dev` with `--dry-run` first, then for real, and `check bus-stops`, as above.
3. Within a minute, `/bus/stops/100900221/arrivals` (and its alias `/bus/stops/seoul-01618/arrivals`) answers the page of `hssc-bus-lot` with both its shuttle runs and 종로07, `/bus/config/jongro07` serves `stopId: "hssc-bus-lot"` on the station with `stationNumber` `01618` under a new ETag, and no `bus.stop_index.alias_unmatched` warning names the id (one does when no stored station has it).
4. Make the same edit in production, push with `--prod` and `check bus-stops --prod`.

A pole with no ARS number can only be aliased by `topisIds`. On a route `/bus/config` does not list (7800), only an aliased pole is a stop: its station serves the local stop's `stopId` on `/bus/live/<groupId>`, the local stop's page lists the route, and the route's other poles stay off `GET /bus/stops`.

Removing an alias is the same edit in reverse: the pole's own page, under its station id, serves again, and the stations name it. An unlisted route's pole exists only through its alias, so that alias stays while the journey dataset names the pole ([ADR 0022, D4](../decisions/0022-journey-and-call-spec.md)): a dataset that declares `recheckTriggers: ["bus-stops"]` (`scripts/lib/datasets/catalog.js`) refuses the push that removes it.

### Add a stop area

A stop area groups the stops a rider calls one place, so the journey planner offers it as one place to pick; each stop keeps its pin and its page ([bus-stops-api.md](../reference/bus-stops-api.md#stop-areas)). Push an area when something cites it ([ADR 0022, D4](../decisions/0022-journey-and-call-spec.md)).

1. Pull `_dev` and add the area to `stopAreas`, listing a local stop by its slug and a Jongno pole by its station id (its `seoul-<ARS number>` alias resolves too):

   ```json
   "stopAreas": [{ "id": "hyehwa-exit1", "name": { "ko": "혜화역 1번 출구", "en": "Hyehwa Stn. Exit 1" }, "stopIds": ["hssc-hyehwa-exit1", "100900075"] }]
   ```

2. Push to `_dev` with `--dry-run` first, then for real, and `check bus-stops`, as above. The push reads `bus_campus.jongro_routes` and `jongro_route_paths` of the target (`_dev` without `--prod`) to resolve each pole member and place it.
3. Within a minute, `GET /bus/stops` serves `stopAreaId: "hyehwa-exit1"` on both stops, under a new ETag, and so do their stop pages; no `bus.stop_index.stop_area_member_unmatched` warning names a member.
4. Make the same edit in production, push with `--prod` and `check bus-stops --prod`.

An area id is never renamed or removed while another dataset cites it: the push names the citing dataset and path.

A new top-level key such as `stopAreas` is unknown to a server deployed before it, whose strict schema refuses the whole revision, so the first push that uses it goes in this order:

1. Deploy the code that reads the key to production.
2. Run `npm run data -- check --prod` from a checkout of that deployed `main`, so the stored revisions pass this code.
3. Push the key, to `_dev` and then with `--prod`.

### Change a sequence's length

Adding or removing a stop of a sequence changes the length of every `stopTimes` of its service and route type, which `npm run schedule` writes from `scripts/data/campus-schedule.json` or `scripts/data/commute-schedule.json`. Each writer refuses while the other side is old, so the sequence goes first, checked against the new timetable file:

1. Edit the sequence in `.data/dev/bus-stops.json` and the timetable file: one more (or one fewer) time in every `stopTimes` of that service and route type, `null` where the new stop is estimated.
2. Push the sequence against the file. The tool checks against the file's entries in place of the stored ones of the same service and pattern, and prints the command that applies the file (with `--create` when the file holds a pattern the target does not store). `--against` takes one file: a push that changes the length of sequences of both timetable files is refused either way, so split it, one push and one `npm run schedule` per file. A stored pattern the file does not list, such as last semester's, which `npm run schedule` lists as "not in this file" and never deletes, is checked only while it serves a date: one whose `effectiveUntil` is before today (KST) is printed as `skipped` and left out, by both tools. One that ends today or later still blocks a length change of its service, so ask the owner. `--dry-run` previews the push and names the command; `npm run schedule` cannot be previewed before the push, since it refuses the new file against the stored sequences:

   ```bash
   npm run data -- push bus-stops --against scripts/data/commute-schedule.json --note "gangnam down: Nonhyeon stop"
   ```

3. Apply the timetable at once with the printed command, here `npm run schedule -- --file scripts/data/commute-schedule.json`. Between the two writes the smart view serves the old stop times against the new stops, and the stored estimates of that sequence are dropped and fetched again.
4. Check both sides: `npm run data -- check bus-stops` and `npm run schedule -- --file scripts/data/commute-schedule.json --check`.
5. Repeat in production: `npm run data -- pull bus-stops --prod`, the same edit in `.data/prod/bus-stops.json`, `npm run data -- push bus-stops --prod --against <timetable file>`, then the printed `npm run schedule … --prod`. Push from a checkout at the deployed `main` ([the warning above](#overview)), but `--against` still names the new timetable file, which `main` does not hold until the change merges: copy it into that checkout's `scripts/data/`, or pass the path of the file in your working checkout. The printed command names the same path. Against `main`'s own file, which still has the old length, the push is refused.

To copy the change into `_dev` later, `copy-prod-to-dev bus-stops` checks production's sequences against `_dev`'s stored timetables, so it takes `--against` the new file too, and prints the `npm run schedule` command for `_dev`:

```bash
npm run data -- copy-prod-to-dev bus-stops --against scripts/data/commute-schedule.json
```

### Roll back

```bash
npm run data -- history bus-stops --prod
npm run data -- rollback bus-stops <revision> --prod
```

A rollback runs the push checks and reaches every route within a minute, like a push. A rollback that changes a sequence's length is refused while the stored timetable fits the newer one: roll back `--against` the timetable file of that revision's length, then apply it with the printed command, as in [Change a sequence's length](#change-a-sequences-length). That file is the committed one from before the length change; write it out of git, naming the commit before the change (`git log -- scripts/data/commute-schedule.json` lists them):

```bash
git show <commit>:scripts/data/commute-schedule.json > /tmp/commute-schedule.before.json
npm run data -- rollback bus-stops <revision> --prod --against /tmp/commute-schedule.before.json
```

Then run the printed `npm run schedule -- --file /tmp/commute-schedule.before.json --prod`, and revert the timetable file in git so the committed file matches production again.

## Verify

- `npm run data -- check bus-stops --prod` exits `0`, and after a length change `npm run schedule -- --file <timetable file> --check --prod` does too.
- Within a minute, `/bus/config/<group>` answers the new body with a new ETag, and an untouched group keeps its ETag.
- (An operations detail is left out of the public history.)

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| The push is refused at `stops.<n>.id` | The id breaks the grammar, holds no letter or starts with `seoul-` | Pick a slug; never rename a served one |
| The push is refused at `hssc.stations` | Not exactly `HSSC_POSITION_COUNT` positions | The count is code: change it there, with the HSSC API matching, first |
| The push is refused at `hssc.stations.<n>.stopId`, naming `isHsscPassThrough` | A `null` where the shuttle stops, or a stop where it passes through | The pass-through positions are code: change `isHsscPassThrough`, which the HSSC estimates read too, and deploy first |
| The push is refused naming a lane strategy | `LANE_STRATEGIES` sets one for a sequence the data drops | Keep the sequence, or remove the strategy in code and deploy first |
| `/bus/config` answers `503 BUS_STOPS_UNAVAILABLE` | A replica has never read a good `bus-stops` (missing, invalid or unreadable) | `npm run data -- check bus-stops --prod`; roll back to the last good revision |
| `bus.stops.invalid` in the logs after a push the tool accepted | The checkout you pushed from is not the deployed code, which refuses the revision | Roll back to the last good revision now, within the 24 hours, then push again from a checkout at the deployed `main` |
| The push is refused at `sequences.<service>.<route type>`, "timetable entries do not fit this sequence" | The stored `stopTimes` of that service and route type have the sequence's old length | A length change: push `--against` the new timetable file, then apply it ([above](#change-a-sequences-length)) |
| `npm run schedule` fails with `MISMATCH` lines | The file's `stopTimes` do not fit the target's stored `bus-stops` sequences | Fix the file, or push the new sequence first with `--against` this file |
| `npm run schedule` fails with `bus-stops is not stored` | The target content database holds no `bus-stops` | Push `bus-stops` to that target first |
| `copy-prod-to-dev bus-stops` is refused, "timetable entries do not fit this sequence" | Production holds a length change that `_dev`'s stored timetable does not have yet | `copy-prod-to-dev bus-stops --against <new timetable file>`, then the printed `npm run schedule` command ([above](#change-a-sequences-length)) |
| A push `--against` the new file is still refused for the other timetable's service | The push changes sequence lengths of services in both timetable files; `--against` replaces one file's entries | Split the push per file: change, push and apply one file's sequences, then the other's |
| A `skipped` line names a pattern | The pattern ended before today (KST), so it serves no date ahead, and neither tool checks its stop times | Nothing; it stays stored, since `npm run schedule` never deletes a pattern |
