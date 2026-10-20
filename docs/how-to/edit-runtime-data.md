---
title: Edit Runtime Data
type: how-to
status: draft
owner: zoyoong124@gmail.com
last-updated: 2026-10-20
audience: internal
---

# Edit Runtime Data

> How to read and change a dataset in the content database with `npm run data`: pull, edit, push, history, rollback, copying production into `_dev`, and the `check` to run before a deploy that changes a dataset's schema or removes an identity a dataset names.

## Overview

Runtime data the server serves lives in MongoDB as datasets ([ADR 0013](../decisions/0013-runtime-data-in-mongodb.md)). Each dataset is one document in the content database's `datasets` collection, with a revision that only moves forward; every version stored is kept in `dataset_revisions`, the newest 50 per dataset. `npm run data` is the only writer, and the server only reads. The datasets the tool knows, and the server code that validates each one, are listed in `scripts/lib/datasets/catalog.js`:

| Dataset | Served on | Never read | References |
| --- | --- | --- | --- |
| `miniapps` | `GET /miniapps`, `GET /miniapps/:id`, the feed and send routes, and every dataset below that names a mini app | 503 `MINIAPP_REGISTRY_UNAVAILABLE` | none; each first-party origin's owner is the one `src/infra/origins.ts` names. Named by the three ui datasets, so a push may not drop an id they name ([register-a-miniapp.md](register-a-miniapp.md)) |
| `home-layout` | `GET /ui/home` | 503 `HOME_LAYOUT_UNAVAILABLE` | `miniapps`: each `miniapp` tile, feed and `miniapp` action |
| `campus-banners` | `GET /ui/home/campus` | 503 `CAMPUS_BANNERS_UNAVAILABLE` | `miniapps`: each banner's `miniapp` action |
| `transit-layout` | `GET /ui/home/transit` | 503 `TRANSIT_LAYOUT_UNAVAILABLE` | `busGroups` and `subwayStations`: every one the checkout serves, each placed exactly once; `miniapps`: each `miniapp` link |
| `map-layer-sets` | `GET /map/config`, `GET /map/overlays/event`, `GET /map/overlays/event/details`, while an activation is live | the base map, 200; the event routes serve nothing | none; each set is checked against the base layers and chips, one per `layerSetId` ([configure-map-overlays.md](configure-map-overlays.md#add-or-edit-a-festival)) |
| `bus-service-notices` | `GET /bus/schedule/data/:serviceId/smart` and `/week`, and the shuttle estimate pollers | 503 `BUS_SCHEDULE_UNAVAILABLE`; a poller tick rejects | `busServices`: each key is a service the checkout defines ([below](#edit-a-shuttle-notice-or-suspension)) |
| `skku-rest-days` | the same routes and pollers | 503 `BUS_SCHEDULE_UNAVAILABLE`; a poller tick rejects | none; each key is on the calendar ([below](#add-a-skku-rest-day)) |
| `jongro-route-attributes` | `GET /bus/config`, `GET /bus/config/:groupId`, `GET /ui/home/transit`, `GET /ui/home/transitlist`, `GET /bus/realtime/data/jongro*` | `/bus/config` and the two ui routes serve 200 without the Jongro groups; a Jongro group and `/bus/realtime/data/jongro*` answer 503 `JONGRO_ROUTE_ATTRIBUTES_UNAVAILABLE`; the other groups and `/bus/realtime/data/hssc` serve | `jongroRoutes`: exactly one entry per route the checkout serves ([below](#edit-a-jongro-routes-card-or-seat-count)) |
| `bus-lane-corridor` | the live shuttle estimate poller, for 인자셔틀 runs in the lane hours | each such run is estimated by car; the poller tick rejects after storing it | none; the geometry is checked: boundaries in order and the last at the centerline's end, each probe route listed once with direction ranges that do not overlap ([below](#rebuild-the-bus-lane-corridor)) |

A never-read answer is what a replica that has no good value serves, with no `Cache-Control` for a 503; one that read a good value keeps serving it for 24 hours through failed reads. The poller reads the two bus datasets too, so a push reaches the shuttle estimates within the same minute. `busGroups`, `subwayStations` and `busServices` are code-held lists, read from your checkout, not datasets ([configure-home.md](configure-home.md#transit-layout) for the order of a push and a deploy that changes a bus group or station).

Every push is validated with the server's own schema and rules, compiled from your checkout, and checked for references against the datasets stored in the database it targets: a home layout tile that names a mini app that database's `miniapps` does not hold is refused, naming the tile's path, and so is a `miniapps` push that drops an id a stored layout still names. Nothing is written while any issue stands.

| Target | Database | How |
| --- | --- | --- |
| Development (default) | `$MONGO_CONTENT_DB_NAME` plus `_dev` | no flag |
| Production | `$MONGO_CONTENT_DB_NAME` | `--prod` |

The tool prints the database name first on every run. The `_dev` database lives on the production cluster, so it is real data too, but nothing user-facing reads it.

## Prerequisites

- A `.env` with `MONGO_URL` and `MONGO_CONTENT_DB_NAME`: `npm run env:pull` renders it from Doppler `backend/dev_server`.
- `git config user.email` set, or `--by <email>` on every write: it is stored as the author of the revision.
- A checkout of the code you mean to validate against. `npm run data` runs `npm run build` first and loads the schemas from `dist/src`, so the build output is always this checkout's.

> [!WARNING]
> Never print, paste or share `MONGO_URL`, in a terminal log, an issue or a chat. The tool itself prints database names only, and removes the URL's credentials and hosts from every line, error messages included: with `mongodb+srv`, every replica host of the cluster's domain, and any IP address. Keep it that way when you report a failure: copy the tool's output, not your `.env`.

## Steps

### Edit a dataset

1. Pull it. This writes `.data/dev/<dataset>.json` (git-ignored) holding the data and the revision you pulled:

   ```bash
   npm run data -- pull home-layout
   ```

2. Edit the `data` field of that file. Leave `dataset`, `target` and `baseRevision` alone.
3. Preview the change. `--dry-run` prints the target and a diff of every changed path, and writes nothing:

   ```bash
   npm run data -- push home-layout --dry-run
   ```

4. Push it, with a note saying why:

   ```bash
   npm run data -- push home-layout --note "add the library tile"
   ```

   The push stores the next revision, prints it, and moves the working file's `baseRevision` to it, so you can keep editing the same file. A file whose data equals the stored revision reports "no change" and writes nothing.

Every api replica that serves the dataset reads the new revision within 60 seconds, with no restart and no deploy.

### Edit production

Production has its own working file, `.data/prod/<dataset>.json`, and a file is only ever pushed to the database it was pulled from:

```bash
npm run data -- pull home-layout --prod
# edit .data/prod/home-layout.json
npm run data -- push home-layout --prod --note "add the library tile"
```

The push prints the diff and asks you to type `y`. Anything else writes nothing. A run without a terminal (a script, CI) writes nothing to production unless it passes `--yes`, which skips the question; use it only where the diff is printed to someone who will read it.

To try an edit on `_dev` first, make it there, then pull production and make the same edit to the production file. No command copies `_dev` data into production.

### Create a dataset

A dataset that is not stored yet is created from a plain JSON file holding the data itself (no working-file wrapper), as revision 1:

```bash
npm run data -- push home-layout --create --file path/to/home-layout.json --note "import from <commit>"
```

`--create` refuses a dataset that already exists, and a push without it refuses one that does not.

### Read the history

```bash
npm run data -- history home-layout
npm run data -- history home-layout --prod --limit 10
```

It lists revisions newest first, each with its time, author, command (`create`, `push`, `rollback to <n>`, `copy-prod-to-dev from <database>@<n>`) and note, and marks the current one.

### Roll back

A rollback stores an earlier revision's data as a new revision; history is never rewritten:

```bash
npm run data -- rollback home-layout <revision> --prod
```

It runs the same checks as a push, so a revision the current code no longer accepts, or one that names a mini app since removed, is refused with the issues listed. Only the newest 50 revisions are kept; a rollback to an older one is refused, naming the oldest kept.

### Refresh `_dev` from production

```bash
npm run data -- copy-prod-to-dev home-layout
```

It stores production's current data as the next `_dev` revision and records which production revision it copied. Pull `_dev` again afterwards: a working file pulled before the copy is now stale.

### Edit a shuttle notice or suspension

`bus-service-notices` holds each shuttle service's notices and suspension, keyed by service id: `{ "services": { "<serviceId>": { "notices": [...], "suspend": null } } }`. Service ids and what the code does with a service stay in `SERVICE_CONFIG` (`src/bus/bus.constants.ts`); a service the dataset leaves out shows no notice and is never suspended.

- A notice is `{ "style": "info" | "warning" | "ai", "text": "…" }`, shown on every day with a timetable, in order. The app has no `error` style (it would draw one as `info`), so a push with it is refused. Apps draw `notices[0]` as the banner, so keep the 통학셔틀 pilot notice first and the live-traffic `ai` notice last.
- A suspension is `{ "from": "YYYY-MM-DD", "until": "YYYY-MM-DD" }`, both days included. Inside it the smart view answers `status: "suspended"` with `resumeDate` the day after `until`, and the estimate pollers plan no run.

To suspend the 인자셔틀 for the winter break, pull production, set `campus-inja`'s `suspend`, and push:

```json
"campus-inja": { "notices": [{ "style": "ai", "text": "도착 시간은 실시간 교통 상황을 반영해요" }], "suspend": { "from": "2026-12-21", "until": "2027-02-28" } }
```

```bash
npm run data -- push bus-service-notices --prod --note "winter break suspension"
```

On 2026-12-22 the smart view answers `suspended` with `resumeDate: "2027-03-01"`. Before the suspension starts, the smart view still shows its days' timetable (on Saturday 12-19, the week of 12-21), but the estimate pollers already plan no run on them, so those runs carry no estimate. Set `suspend` back to `null` to end it early.

### Add a SKKU rest day

`skku-rest-days` holds SKKU's own rest days (founding days, 학사휴교), on which every service with `respectsKoreanHolidays` runs no timetable. Each key is a date and each value the label shown on the day:

- `MM-DD` recurs every year (`"09-28": "공자탄신일"`); `02-29` is allowed, `02-30` is refused.
- `YYYY-MM-DD` applies once (`"2027-03-02": "학사휴교"`), from 1900 to 2999.

A one-off date wins over a yearly one on the same day, either wins over a public holiday, and a `bus_overrides` document for that service and date wins over all three. Public holidays never go here: the server reads them from the official calendar. Use an override instead when the closure must carry a notice.

### Edit a Jongro route's card or seat count

`jongro-route-attributes` holds each Jongno village bus route's card and capacity, keyed by route id: `{ "routes": { "jongro07": { "themeColor": "4CAF50", "iconType": "village", "refreshInterval": 25, "seatCount": 18, "transferLinesByArsId": { "01220": [{ "line": "4", "color": "00A5DE" }] } } } }`. The ids and TOPIS route ids stay in code (`JONGRO_ROUTES` in `src/bus/bus.constants.ts`); the stations are the registry's. Colors are six hex digits without `#`, `seatCount` a positive integer (crowding is relaxed up to it, normal up to 1.5 times it), and a stop's subway badges are keyed by its ARS number, so they follow the stop when TOPIS moves it. A push that leaves out a route the checkout serves, or names one it does not, is refused. A push reaches every route within a minute, the `/bus/config` ETag included; the map's route lines keep their own green. A transfer line whose ARS number no stored station has serves nothing and logs `bus.jongro.registry_unmatched_transfer`. A deploy that adds a route pushes its attributes from that checkout first: until then the route is left out of `/bus/config`, and its group and realtime routes answer 503.

```bash
npm run data -- pull jongro-route-attributes --prod
# edit .data/prod/jongro-route-attributes.json
npm run data -- push jongro-route-attributes --prod --note "jongro07 seat count 25"
```

### Rebuild the bus-lane corridor

`bus-lane-corridor` holds the Gyeongbu Expressway bus-lane corridor the 인자셔틀 estimates time: the centerline with its named boundaries (`corridor`), each direction's entry and exit points (`entryExit`, which NAVER routes through) and the probe routes whose bus positions time it (`probeRoutes`, each with its TOPIS section range per direction). Which runs use it, in which direction, and the lane hours are code (`LANE_STRATEGIES` and `LANE_HOURS` in `src/bus/eta/lane/bus-eta-lane.constants.ts`). Edit an entry or exit point or a probe route by hand; rebuild the centerline and the section ranges from OpenStreetMap and TOPIS with the builder, which rewrites them in the pulled file and keeps `entryExit`:

```bash
npm run data -- pull bus-lane-corridor --prod
doppler run -p backend -c dev_server -- node scripts/build-bus-lane-corridor.js --file .data/prod/bus-lane-corridor.json
doppler run -p backend -c dev_server -- node scripts/build-bus-lane-corridor.js --file .data/prod/bus-lane-corridor.json --check-probe live
npm run data -- push bus-lane-corridor --prod --note "corridor rebuilt from OSM"
```

`--dry-run` prints the summary and writes nothing. After any `entryExit` edit, run the entry-exit check before the push, with the pull's `--file`:

```bash
doppler run -p backend -c dev_server -- node scripts/build-bus-lane-corridor.js --file .data/prod/bus-lane-corridor.json --check-entry-exit
```

It routes both directions through the file's entry and exit points with NAVER; a point NAVER cannot route through fails every forced route, and each bus-lane run then loses its live value. Of `entryExit`, the push itself refuses only a point more than 500 m off the centerline, or a direction whose exit lies before its entry along it. The live poller reads a push within two minutes (two ticks): the corridor cache lives 60 s, as long as a tick.

### Check before a deploy

The server reads datasets the code may no longer accept. A deploy restarts every replica with an empty cache, so a stored home layout the new schema rejects answers 503 on `/ui/home` until a valid push, and a removed mini app loses every tile that names it. Before merging a change that tightens a dataset's schema or rules, or removes an identity a dataset references (a mini app from the registry, a bus group, a served subway station), run from that change's checkout:

```bash
npm run data -- check --prod
```

It runs the push checks on the stored data of every dataset, writes nothing, and exits non-zero on any issue. `check <dataset>` checks one. Fix the data first (pull, edit, push), then merge.

## Troubleshooting

| Message | Meaning | What to do |
| --- | --- | --- |
| `CONFLICT: <dataset> is at revision <n>, stored by <who> at <time>` | Someone pushed since you pulled. Nothing was written. | Pull again, redo your edit on the new file, push. |
| `REFUSED: <n> issue(s), nothing written`, one line per `<dataset> <path> <message>` | The data fails the schema, a rule, or a reference. | Fix each path. An unknown key such as `actoinType` is a typo; `"<id>" is not a registered mini app` names the target database's registry, and `"<id>" is not in miniapps (no stored dataset)` means it holds none yet. |
| `... was pulled from the development database, so it cannot be pushed to <prod>` | You pushed a `_dev` working file with `--prod`. | `pull --prod` and redo the edit on `.data/prod/`. |
| `refusing to write ... (PRODUCTION) without a confirmation` | A production write with no terminal and no `--yes`. | Run it in a terminal, or pass `--yes` where the diff is reviewed. |
| `dist/src is missing: run npm run build first` | You ran `node scripts/data.js` without a build. | Use `npm run data`, which builds first. |
| `repaired: ... had no history entry` | A push stopped between storing the dataset and recording its history. The tool recorded the entry. | Nothing. `check`, `--dry-run` and a `--prod` run without `--yes` only report it as a `note:`; with `--prod`, a `push` or `rollback` you confirm records it first. |
| `MongoServerSelectionError: ...` with `<redacted>` in it | The database could not be reached; the host is hidden on purpose. | Check your network and `.env`, without printing them. |

## Related

- [ADR 0013](../decisions/0013-runtime-data-in-mongodb.md): why runtime data lives in MongoDB, and the read contract every dataset reader keeps
- [configure-home.md](configure-home.md): what the home layout, the campus banners and the transit layout hold
- [bus-architecture.md](../explanation/bus-architecture.md): how the schedule routes and the estimate pollers fold in the two bus datasets
- [register-a-miniapp.md](register-a-miniapp.md): the registry a home layout's references resolve against
- `scripts/data.js`: the command line; `scripts/lib/datasets/`: the catalog, checks, store and working file
- [docs/README.md](../README.md): writing rules
