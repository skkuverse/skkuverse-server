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
  "hssc":      { "stations": [ { "stopId", "name", "subtitle"?, "isFirstStation", "isLastStation", "isRotationStation", "transferLines" } ] },
  "topis"?:    { "<ARS number>": { "name"?: { "en"?, "zh"? }, "subwayStationId"? } } }
```

What stays in code, and needs a deploy to change: the service ids and which route types get arrival estimates (`SERVICE_CONFIG` in `src/bus/bus.constants.ts`), the travel strategies (`LANE_STRATEGIES`), the HSSC position count (`HSSC_POSITION_COUNT`) and how the HSSC API's stop names map to positions (`src/bus/realtime/hssc/`). Jongno stops are TOPIS's and are never stored here.

Every stop of a sequence or the HSSC line, and every Jongno pole, has a stop page, `GET /bus/stops/:stopId/arrivals` ([bus-stops-api.md](../reference/bus-stops-api.md)). What it shows, and where each part comes from:

| On the page | From |
| --- | --- |
| The stop's name, detail, photo, street view and subway link | The stop's record in this dataset, as `/bus/config` serves it, without its map guide |
| The stop's coordinates | The stop's `coords`; for a Jongno pole, or an aliased stop with none, the pole's on the stored route line |
| A Jongno pole's name and id | The stored registry station (`seoul-<ARS number>`, its Korean name): not this dataset |
| The routes and their order | The HSSC line's `stopId`s and the sequences' stops here, then the registry's poles, in `/bus/config`'s group order; an alias in `arsIds` adds its pole's Jongno routes to the local stop |
| A shuttle entry's next runs | The stored timetable and estimates, through the smart schedule; boarding and drop-off stops alike |
| An HSSC entry's buses | `bus_cache`, as the HSSC realtime route serves them |

Every realtime station of `/bus/config` names its stop page as `stopId`, its last field: an HSSC position its `stopId` here, a Jongno station `seoul-<ARS number>` or the local stop aliasing it, and a position with none (the two non-stop 혜화동로터리 rows) no key ([bus-stops-api.md](../reference/bus-stops-api.md#stop-ids-on-the-realtime-stations)).

A push that changes a stop, a sequence or an alias reaches its page within a minute, and an alias the `stopId` of its pole's stations in each Jongro group, whose ETag changes with it. A slug renamed or removed answers `404` on its page, so never rename a served one: the app may hold it.

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

### Add an alias

(An operations detail is left out of the public history.)

1. Pull `_dev` and add the pole's ARS number to the local stop's `arsIds`, keeping every other field of its entry:

   ```json
   { "id": "hssc-bus-lot", "…": "the entry's other fields, unchanged", "arsIds": ["01618"] }
   ```

2. Push to `_dev` with `--dry-run` first, then for real, and `check bus-stops`, as above.
3. Within a minute, `/bus/stops/seoul-01618/arrivals` answers the page of `hssc-bus-lot` with both its shuttle runs and 종로07, `/bus/config/jongro07` serves `stopId: "hssc-bus-lot"` on the station with `stationNumber` `01618` under a new ETag, and no `bus.stop_index.alias_unmatched` warning names the number (one does when no stored station has it).
4. Make the same edit in production, push with `--prod` and `check bus-stops --prod`.

Removing an alias is the same edit in reverse: the pole's own page `seoul-<ARS number>` serves again, and the stations name it.

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
| The push is refused at `stops.<n>.id` | The id breaks the grammar or starts with `seoul-` | Pick a slug; never rename a served one |
| The push is refused at `hssc.stations` | Not exactly `HSSC_POSITION_COUNT` positions | The count is code: change it there, with the HSSC API matching, first |
| The push is refused naming a lane strategy | `LANE_STRATEGIES` sets one for a sequence the data drops | Keep the sequence, or remove the strategy in code and deploy first |
| `/bus/config` answers `503 BUS_STOPS_UNAVAILABLE` | A replica has never read a good `bus-stops` (missing, invalid or unreadable) | `npm run data -- check bus-stops --prod`; roll back to the last good revision |
| `bus.stops.invalid` in the logs after a push the tool accepted | The checkout you pushed from is not the deployed code, which refuses the revision | Roll back to the last good revision now, within the 24 hours, then push again from a checkout at the deployed `main` |
| The push is refused at `sequences.<service>.<route type>`, "timetable entries do not fit this sequence" | The stored `stopTimes` of that service and route type have the sequence's old length | A length change: push `--against` the new timetable file, then apply it ([above](#change-a-sequences-length)) |
| `npm run schedule` fails with `MISMATCH` lines | The file's `stopTimes` do not fit the target's stored `bus-stops` sequences | Fix the file, or push the new sequence first with `--against` this file |
| `npm run schedule` fails with `bus-stops is not stored` | The target content database holds no `bus-stops` | Push `bus-stops` to that target first |
| `copy-prod-to-dev bus-stops` is refused, "timetable entries do not fit this sequence" | Production holds a length change that `_dev`'s stored timetable does not have yet | `copy-prod-to-dev bus-stops --against <new timetable file>`, then the printed `npm run schedule` command ([above](#change-a-sequences-length)) |
| A push `--against` the new file is still refused for the other timetable's service | The push changes sequence lengths of services in both timetable files; `--against` replaces one file's entries | Split the push per file: change, push and apply one file's sequences, then the other's |
| A `skipped` line names a pattern | The pattern ended before today (KST), so it serves no date ahead, and neither tool checks its stop times | Nothing; it stays stored, since `npm run schedule` never deletes a pattern |
