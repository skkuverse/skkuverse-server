---
title: Edit Runtime Data
type: how-to
status: draft
owner: zoyoong124@gmail.com
last-updated: 2026-10-25
audience: internal
---

# Edit Runtime Data

> How to read and change a dataset in the content database with `npm run data`: pull, edit, push, history, rollback, copying production into `_dev`, a parted dataset's directory of part files, and the `check` to run before a deploy that changes a dataset's schema or removes an identity a dataset names.

## Overview

Runtime data the server serves lives in MongoDB as datasets ([ADR 0013](../decisions/0013-runtime-data-in-mongodb.md)). Each dataset is one document in the content database's `datasets` collection, with a revision that only moves forward; every version stored is kept in `dataset_revisions`, the newest 50 per dataset. A dataset too large for one document is parted: that document is its header, and its parts live in `dataset_parts` ([below](#edit-a-parted-dataset)). `npm run data` is the only writer, and the server only reads. The datasets the tool knows, and the server code that validates each one, are listed in `scripts/lib/datasets/catalog.js`:

| Dataset | Served on | Never read | References |
| --- | --- | --- | --- |
| `miniapps` | `GET /miniapps`, `GET /miniapps/:id`, the feed and send routes, and every dataset below that names a mini app | 503 `MINIAPP_REGISTRY_UNAVAILABLE` | none; each first-party origin's owner is the one `src/infra/origins.ts` names. Named by the three ui datasets, so a push may not drop an id they name ([register-a-miniapp.md](register-a-miniapp.md)) |
| `games` | `GET /games`, `GET /games/:id` | 503 `GAME_REGISTRY_UNAVAILABLE` | none; each entry URL is on the origin `src/infra/origins.ts` maps to its id, and no id is one the stored `miniapps` holds, nor a mini app's id one it lists. Named by home layout game tiles, so a push may not drop an id a stored layout names ([games-api.md](../reference/games-api.md)) |
| `app-platform-gates` | `GET /app/config`, as `ios` and `android` | 503 `APP_PLATFORM_GATES_UNAVAILABLE` for the whole route | none; one gate per platform, each a three-part `minVersion`, an https `updateUrl` and a `minOsVersion` (an iOS version or an Android API level) ([below](#raise-an-app-platform-gate)) |
| `home-layout` | `GET /ui/home` | 503 `HOME_LAYOUT_UNAVAILABLE` | `miniapps`: each `miniapp` tile, feed and `miniapp` action; `games`: each `game` tile but the bundled games (`BUNDLED_GAME_IDS`) |
| `campus-banners` | `GET /ui/home/campus` | 503 `CAMPUS_BANNERS_UNAVAILABLE` | `miniapps`: each banner's `miniapp` action |
| `transit-layout` | `GET /ui/home/transit` | 503 `TRANSIT_LAYOUT_UNAVAILABLE` | `busGroups` and `subwayStations`: every one the checkout serves, each placed exactly once, a station with no campus at most once; `miniapps`: each `miniapp` link |
| `map-layer-sets` | `GET /map/config`, `GET /map/overlays/event`, `GET /map/overlays/event/details`, while an activation is live | the base map, 200; the event routes serve nothing | none; each set is checked against the base layers and chips, one per `layerSetId` ([configure-map-overlays.md](configure-map-overlays.md#add-or-edit-a-festival)) |
| `bus-service-notices` | `GET /bus/schedule/data/:serviceId/smart` and `/week`, and the shuttle estimate pollers | 503 `BUS_SCHEDULE_UNAVAILABLE`; a poller tick rejects | `busServices`: each key is a service the checkout defines ([below](#edit-a-shuttle-notice-or-suspension)) |
| `skku-rest-days` | the same routes and pollers | 503 `BUS_SCHEDULE_UNAVAILABLE`; a poller tick rejects | none; each key is on the calendar ([below](#add-a-skku-rest-day)) |
| `jongro-route-attributes` | `GET /bus/config`, `GET /bus/config/:groupId`, `GET /ui/home/transit`, `GET /ui/home/transitlist`, `GET /bus/realtime/data/jongro*` | `/bus/config` and the two ui routes serve 200 without the Jongro groups; a Jongro group and `/bus/realtime/data/jongro*` answer 503 `JONGRO_ROUTE_ATTRIBUTES_UNAVAILABLE`; the other groups and `/bus/realtime/data/hssc` serve | `jongroRoutes`: exactly one entry per route the checkout serves ([below](#edit-a-jongro-routes-card-or-seat-count)) |
| `bus-stops` | `GET /bus/config`, its `hssc`, `campus`, `commute` and Jongro groups (the stop ids of their stations), `GET /ui/home/transit`, `GET /ui/home/transitlist`, the estimates of `GET /bus/schedule/data/:serviceId/smart`, and the shuttle estimate pollers | `/bus/config`, those groups and the two ui routes answer 503 `BUS_STOPS_UNAVAILABLE`; the smart view serves the timetable without estimates; each poller tick rejects before any upstream call; `fasttrack` and the realtime routes serve | `subwayStations`: each stop's and overlay entry's station; `busServices`: each sequence's service. Each sequence is checked against the target's stored timetables, `bus_campus.bus_schedules` (`_dev` without `--prod`): every entry's `stopTimes` has one time per stop, `null` only at an estimated one. Its stop ids may be named by later datasets ([edit-bus-stops.md](edit-bus-stops.md)) |
| `hssc-route-line` | `GET /map/overlays/transit`, as the `hssc_route` path | the Jongno lines without the HSSC line, 200, cached a minute | none; the line is checked: positions in range, at least 10 points, closed (the last point repeats the first), no segment over 100 m ([ADR 0018, D9](../decisions/0018-hssc-arrival-estimates.md)) |
| `bus-lane-corridor` | the live shuttle estimate poller, for 인자셔틀 runs in the lane hours | each such run is estimated by car; the poller tick rejects after storing it | none; the geometry is checked: boundaries in order and the last at the centerline's end, each probe route listed once with direction ranges that do not overlap ([below](#rebuild-the-bus-lane-corridor)) |
| `subway-topology` | `GET /subway/stations/:id/arrivals`, and the `subway-seoul` and `subway-trainmap` pollers | 503 `SUBWAY_TOPOLOGY_UNAVAILABLE`; each poller tick rejects before any upstream call | `subwayPlatforms`: exactly one entry per platform the checkout serves, and every named stop a served platform or a neighbor; each direction follows its platform's route in the stored `subway-timetables` ([below](#edit-subway-coverage)) |
| `subway-station-coords` | `GET /subway/stations/:id/arrivals`, as `station.coords` | 200, each station's `coords` null | `subwayStations`: exactly one entry per station the checkout serves, each point inside South Korea ([below](#edit-a-subway-stations-coords)) |
| `subway-timetables` (parted: one part per operator line and day type) | `GET /subway/stations/:id/arrivals` for a platform with no fresh arrival state, and the `subway-seoul` and `subway-trainmap` pollers | 503 `SUBWAY_TIMETABLES_UNAVAILABLE`, only for an answer that needs a table; a poller tick writes the platforms it could schedule, then rejects | none; each table parses with the server's schema, one per key, and every platform the checkout serves has one for each day type its source declares ([update-subway-timetables.md](update-subway-timetables.md)) |

A never-read answer is what a replica that has no good value serves, with no `Cache-Control` for a 503; one that read a good value keeps serving it for 24 hours through failed reads. The poller reads the two schedule datasets, `bus-stops` and `subway-topology` too, so a push reaches the shuttle estimates and the subway pollers within the same minute. `busGroups`, `subwayStations`, `subwayPlatforms`, `busServices` and `jongroRoutes` are code-held lists, read from your checkout, not datasets ([configure-home.md](configure-home.md#transit-layout) for the order of a push and a deploy that changes a bus group or station).

Every push is validated with the server's own schema and rules, compiled from your checkout, and checked for references against the datasets stored in the database it targets: a home layout tile that names a mini app that database's `miniapps` does not hold is refused, naming the tile's path, and so is a `miniapps` push that drops an id a stored layout still names. Nothing is written while any issue stands.

A dataset's check may also read a collection outside the content database, declared in its catalog entry: `bus-stops` reads `bus_campus.bus_schedules` (`$MONGO_DB_NAME_BUS_CAMPUS`, with `_dev` unless `--prod`). The tool prints `reads      <database>.<collection>` for each, reads it from the same target as the push, and never writes it. `push bus-stops --against <timetable file>` (or `rollback … --against`, `copy-prod-to-dev … --against`) checks the sequences against that file instead of the stored entries of the same service and pattern, then prints the `npm run schedule` command that applies it ([edit-bus-stops.md](edit-bus-stops.md#change-a-sequences-length)). A timetable pattern that ended before today (KST) serves no date ahead: the tool prints it as `skipped` and does not check it.

| Target | Database | How |
| --- | --- | --- |
| Development (default) | `$MONGO_CONTENT_DB_NAME` plus `_dev` | no flag |
| Production | `$MONGO_CONTENT_DB_NAME` | `--prod` |

The tool prints the database name first on every run. The `_dev` database lives on the production cluster, so it is real data too, but nothing user-facing reads it.

## Prerequisites

- A `.env` with `MONGO_URL` and `MONGO_CONTENT_DB_NAME` (and `MONGO_DB_NAME_BUS_CAMPUS` for `bus-stops`): `npm run env:pull` renders it from Doppler `backend/dev_server`.
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

### Edit a parted dataset

A parted dataset is one whose catalog entry declares `parts`. Its `datasets` document is a header whose data is a manifest, `{ "parts": [{ "key", "partId", "summary" }] }` ordered by key, and each part is one document of `dataset_parts`, stored under `<dataset>/<key>@<first 16 hex of its sha256>`. A part never changes once stored: a revision that keeps a part's content names the same document, so the history holds only manifests.

1. Pull it. This writes a directory, not a file:

   ```text
   .data/dev/<dataset>/working.json        the dataset, target, pulled revision and manifest
   .data/dev/<dataset>/parts/<key>.json    one file per part, its data
   ```

2. Edit the part files, regenerate them with the dataset's converter, add a file or delete one. Leave `working.json` alone. The push keys each file by the content's own key (the catalog's `keyOf`), not by the file name, and refuses two files with the same key.
3. Preview with `--dry-run`, then push with a note:

   ```bash
   npm run data -- push <dataset> --dry-run
   npm run data -- push <dataset> --note "why"
   ```

   The push runs the part schema on every file and the dataset's own checks on the whole set, then reports one line per key before it writes:

   ```text
   diff of <dataset> (revision 3 -> 4):
     unchanged  1-holiday
     changed    1-weekday  trainCount: 210 -> 212
     added      2-holiday  {"trainCount":96}
     removed    4-weekday  {"trainCount":180}
   ```

   A directory whose parts all equal the stored ones reports "no change" and writes nothing. The push writes the new parts first, then the header, under the same check of the pulled revision as any push: a push that stops in between leaves the served revision unchanged. `--prod`, its confirmation, the target guard (`--dir` points the push at another pulled directory) and `--dry-run` work as for a single document.

To create one, put its part files in a directory, under any names, and push with `--create --dir <dir>`.

`history` prints each revision's per-part summary under its line. A rollback stores the earlier revision's manifest as a new revision; its parts are still stored, since a part is deleted only when neither the current header nor any of the 50 kept revisions names it, and only an hour after it was saved. A rollback that finds a named part missing is refused, naming it. `copy-prod-to-dev` copies the named parts into `_dev` before the header, and `check` reads every named part and runs the push checks on them.

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

A one-off date wins over a yearly one on the same day, either wins over a rest day of the crawled academic calendar ([ADR 0021](../decisions/0021-academic-calendar.md)) and over a public holiday, and a `bus_overrides` document for that service and date wins over all of them. So a key here corrects or adds to what SKKU's calendar lists. Public holidays never go here: the server reads them from the official calendar. Use an override instead when the closure must carry a notice.

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

### Edit subway coverage

`subway-topology` holds, for each served subway platform keyed by its platform id, its two directions (`up`, `down`): the direction's localized `name`, up to three `upstreamPlatformIds` nearest first (the first is the previous station), the `watchedPlatformIds` beyond them and the `nextPlatformId`; and the `neighbors`, each stop those name that no station serves, by platform id, with its `line`, its `seoulName`, a `trainMapName` where the train map writes another, a localized `name` where it is a previous or next station, and, together, a `stationId` (a lowercase slug of its English name) and its `coords` where a journey ride passes it, so the ride lists it among its `stops` (the Seoul station master row of its station code, as for station coords below). The lines, stations and platforms, with their names, colors, markers, Seoul ids and timetable sources, stay in code (`SUBWAY_LINES` and `SUBWAY_STATIONS` in `src/subway/subway.constants.ts`). A push that leaves out a platform the checkout serves, names one it does not, names a stop that is neither served nor a neighbor or is on another line, leaves a previous or next neighbor unnamed, gives a neighbor a served station's id, a station id without coords or coords without one, or places it outside South Korea is refused at its path; so is one whose upstream, watched or next platforms break the order of the platform's timetable route, or that leaves a stop on that route before the platform neither served nor a neighbor. The routes are the target database's stored `subway-timetables`, so a coverage change pushes its tables first and its topology after, and a topology push is refused while that database stores no tables the checkout can read. A push reaches the arrivals route and the pollers within a minute: a neighbor added there matches the upstream rows written at its Seoul name.

```bash
npm run data -- pull subway-topology --prod
# edit .data/prod/subway-topology.json
npm run data -- push subway-topology --prod --note "watch 관악 for 성균관대 down"
```

A watched or upstream stop must also be a station the converter writes into its line's timetables (`scripts/subway-timetable/convert.py`), so a coverage change usually reruns it too ([update-subway-timetables.md](update-subway-timetables.md)). A change that adds a station or platform deploys first, then pushes its topology from that checkout. Until the push, the new platform is left out of its station's arrivals and logs `subway.topology.platform_missing`, while the stored neighbor entry still names it as a stop. Pushed before the deploy, the topology drops that neighbor entry while the running code does not serve the platform yet: each direction that names it as its previous or next station serves `null` there and logs `subway.topology.stop_unnamed`, and the pollers drop the rows written at its Seoul name.

### Edit a subway station's coords

`subway-station-coords` holds each served subway station's camera point, keyed by its slug: `{ "stations": { "hyehwa": { "lat": 37.582336, "lng": 127.001844 } } }`, WGS84 degrees, the point the app opens the station's sheet on. A point is the mean of the station's lines' platform points (`LAT`, `LOT`) in the Seoul Open Data station master, `http://openapi.seoul.go.kr:8088/<SEOUL_SUBWAY_API_KEY>/json/subwayStationMaster/1/1000/`, one row per line (`ROUTE`) at the station (`BLDN_NM`), rounded to six decimals: 정자 is the mean of its 분당선 and 신분당선 rows. The stations stay in code (`SUBWAY_STATIONS`). A push that leaves out a station the checkout serves, names one it does not, or places a point outside South Korea (lat 33 to 39, lng 124 to 132, so a swapped pair is refused) is refused at its path. A push reaches the arrivals route within a minute. A replica that never read the dataset, or whose revision lacks a station, serves that station with `coords: null` and logs it, at error for an unread dataset and at warn for a missing station.

```bash
npm run data -- pull subway-station-coords --prod
# edit .data/prod/subway-station-coords.json
npm run data -- push subway-station-coords --prod --note "move 정자 to the Shinbundang concourse"
```

A change that adds a station pushes its coords from that checkout before the deploy: the running code ignores a station it does not serve, logged at warn (`subway.station_coords.station_unknown`). A change that removes a station deploys first, then pushes coords without it.

### Raise an app platform gate

`app-platform-gates` holds the force-update gate of each platform, served on `GET /app/config` as `ios` and `android`: `{ "ios": { "minVersion": "3.6.2", "updateUrl": "https://apps.apple.com/app/id6446813434", "minOsVersion": "16.4" }, "android": { … } }`. Below `minVersion` the app blocks on its update screen, unless the device OS is below `minOsVersion`. Follow the checklist in [raise-the-minimum-app-version.md](raise-the-minimum-app-version.md) before a push; the push itself is:

```bash
npm run data -- pull app-platform-gates --prod
# edit .data/prod/app-platform-gates.json
npm run data -- push app-platform-gates --prod --note "iOS floor 3.6.2: <why>"
```

The dataset has no default: a replica that never read a good revision answers 503 on the whole route, so a fresh database gets the dataset (`push --create`) before the deploy that first reads it. The deploy rolls back when an api replica answers `/app/config` with anything but 200.

Create it from the gates production serves now, and never from `__tests__/nest/app-config/fixtures/app-platform-gates.dataset.json`: that fixture holds the 2026-10-19 capture (3.5.0), which is lower than production's floor, so pushing it lowers the force-update floor.

```bash
curl -s "https://api.skkuverse.com/app/config?cb=$RANDOM" | jq '.data | {ios, android}' > /tmp/app-platform-gates.json
npm run data -- push app-platform-gates --create --file /tmp/app-platform-gates.json --prod
```

The push prints the gates it will store. Before you type `y`, check that each platform's `minVersion`, `updateUrl` and `minOsVersion` are the values the `curl` printed from production. Run it from a checkout whose dataset catalog (`scripts/lib/datasets/`) knows `app-platform-gates`: `origin/dev` until the change that added it merges to `main`, and `main` after that. An older checkout answers `unknown dataset "app-platform-gates"`. What the move from the environment variables costs until that merge: [raise-the-minimum-app-version.md](raise-the-minimum-app-version.md#until-the-dataset-reaches-main).

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
| `no stored subway-timetables this checkout can read, so the routes were not checked` | A `subway-topology` push or check found no tables in the target database, or one is missing or fails this checkout's schema. Nothing was written. | Push `subway-timetables` to that database first ([update-subway-timetables.md](update-subway-timetables.md)), or run `check subway-timetables` there to find the part. |
| `key "<key>" is in more than one part: <files>` | Two part files hold content with the same key. Nothing was written. | Delete or fix one of the files. |
| `... part(s) the revision names are not stored` | A rollback names a part that is gone. Nothing was written. | Roll back to another revision, or push the parts again from a directory. |
| `part <id> is stored with different content under the same id` | Two parts' hashes share their first 16 hex digits. The header was not written and nothing was overwritten. | Report it; do not delete the stored part. |
| `MongoServerSelectionError: ...` with `<redacted>` in it | The database could not be reached; the host is hidden on purpose. | Check your network and `.env`, without printing them. |

## Related

- [ADR 0013](../decisions/0013-runtime-data-in-mongodb.md): why runtime data lives in MongoDB, and the read contract every dataset reader keeps
- [configure-home.md](configure-home.md): what the home layout, the campus banners and the transit layout hold
- [bus-architecture.md](../explanation/bus-architecture.md): how the schedule routes and the estimate pollers fold in the two bus datasets
- [subway-architecture.md](../explanation/subway-architecture.md): what of the subway network stays in code and what `subway-topology` holds
- [update-subway-timetables.md](update-subway-timetables.md): rebuilding and pushing `subway-timetables`, the parted dataset
- [register-a-miniapp.md](register-a-miniapp.md): the registry a home layout's references resolve against
- `scripts/data.js`: the command line; `scripts/lib/datasets/`: the catalog, checks, store and working file, and for a parted dataset its parts and working directory
- [docs/README.md](../README.md): writing rules
