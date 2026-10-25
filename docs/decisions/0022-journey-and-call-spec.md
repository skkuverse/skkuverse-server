---
title: Journey and Call Spec
type: adr
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-10-25
audience: internal
---

# 0022. Journey and Call Spec

> One shape for "a vehicle at a stop" across buses, shuttles and the subway, and one journey shape for 길찾기 built from it, so a new line, source or mode plugs in by conforming instead of by redesign. Read it before you change a departure board wire (`/bus/live`, the stop page, `/subway/...`), add a transit source, or touch 길찾기. Accepted 2026-10-25.

## Status

Accepted 2026-10-25. It supersedes, where they disagree, [transit-route-planner.md](../plans/transit-route-planner.md) and [7800-unified-arrivals.md](../plans/7800-unified-arrivals.md).

## Context

- 길찾기 (app ADR 0022, D3: the server plans, the app renders) chains campus shuttles, Seoul buses, 7800 and the subway between 인사캠 and 자과캠, with walks between them. The owner wants taxi, walking, other buses and other lines to plug in later by conforming to one spec.
- The bus side already shares one call shape: the `/bus/live` `arrival` ([ADR 0019](0019-bus-live-api.md)) and its domain twin `StopCall` (`src/bus/bus.types.ts`), for realtime and timetabled buses alike.
- The subway wire (`src/subway/arrivals/subway-arrivals.wire.ts`, [ADR 0017](0017-subway-arrivals.md)) differs:
  - Its instants are UTC `Z` with milliseconds.
  - Its certainty field is `source`, not `basis`.
  - Its `stopsAway` counts 0 for a train approaching as well as standing.
  - It has `destination`, `express` and `isFirstTrain`, which the bus side lacks, and no last-train flag.
- A survey of OTP2, GTFS/GTFS-Realtime, Transmodel/SIRI/OJP, Google Routes, HERE, Navitia, MOTIS, ODsay and TMAP found three shared patterns:
  - One call object serves both departure boards and itineraries (Transmodel `EstimatedCall`, OJP `CallAtStop`, MOTIS `StopTime`, OTP `StopCall`).
  - Legs split into a few structural kinds, with an open vehicle mode inside them (HERE `type` + `transport.mode`, OJP `TimedLeg` + `Service.Mode`).
  - Times are absolute, with scheduled and expected side by side and an explicit basis (SIRI Aimed/Expected; SIRI 2.1 warns that a missing prediction gets read both as "on time" and as "infinitely late").
- (An agent tooling note is left out of the public history.)

## Decision

### D1. Two layers: calls, then journeys

A **call** is one run's visit to one stop. A **journey** route holds options. Each option holds legs, and a ride leg is a line plus a board call and an alight call. The departure boards serve calls, and a ride leg's board and alight are calls of the same type, so one mapper and one app row serve both.

### D2. The call

Declared once in `src/shared/`, as a call wire (zod) and its domain twin. Shared code imports no feature, so the call is its own declaration, and the bus wire uses it.

| Field | Meaning |
| --- | --- |
| `status` | `arriving`, `enRoute`, `waitingToDepart`, `scheduled`, `unknown`; open |
| `expectedArrivalAt`, `expectedDepartureAt`, `scheduledArrivalAt`, `scheduledDepartureAt` | Instants at `+09:00`, to the second (`toKstInstant`), each nullable |
| `basis` | `provider`, `estimate`, `timetable`; open, always present |
| `stopsAway` | Integer ≥ 0, or null |
| `runId` | Opaque string, or null |
| `vehicleId` | Key into the response's vehicles, or null |
| `headsign` | Where the run is going, or null |
| `isFirstRun`, `isLastRun`, `isExpress` | Booleans, or null when unknown |
| `providerText` | The upstream's own text, as received, or null |

Rules:

- **Instants, never countdowns.** Clients count against `meta.serverNow`, which every board and journey response carries (ADR 0019, D1 and D10). The subway drops `Z` and milliseconds.
- **Scheduled and expected side by side.** A producer fills the scheduled pair whenever it knows it. The timetabled shuttle keeps its timetable time beside an estimate, where it drops it today. The subway keeps each train's timetable time, which its estimate step already holds. A live call carries no departure instant (ADR 0019, D14).
- **One basis vocabulary.** `provider` is the upstream's prediction, `estimate` is this server's, and `timetable` is published. Subway `live`, `estimated` and `scheduled` map to `provider`, `estimate` and `timetable`.
- **`stopsAway` per ADR 0019 D4 for every mode:** the stations with a stop before this one, plus one, so 1 is approaching and 0 is standing here. For a subway train:
  - approaching or arrived at this platform: 1 or 0;
  - at upstream platform `i`: `i + 2` while approaching it, `i + 1` once arrived or departed;
  - platforms the train's own timetable row passes are not counted;
  - beyond the tracker's reach: null, while its time is still given.
- **`runId` is stable within one service day and one revision of its timetable.**
  - Bus timetable runs: `serviceId|routeType|date|HH:mm`.
  - Subway: `<line>/<serviceDate>/<trainNo>`, where the served train number is always the timetable's.
  - TOPIS live: null, with `vehicleId` instead.
  - Clients compare it and never parse it.
  - Push checks make a bus schedule's `(routeType, time)` unique per day, and a subway timetable's train numbers unique per line and day type.
- **`isLastRun` is the one home of the last-run flag.** On a board it means the last run of its line and direction at this stop. On a ride leg's board it means the last run that reaches the alight stop. The vehicle's `isLastBus` is removed. `isFirstRun` is the subway's `isFirstTrain` and the bus timetable's first run of the day. `isExpress` is null for buses.
- **The time of a call** is the first non-null of expected departure, scheduled departure, expected arrival and scheduled arrival.
- **Vehicles stay separate objects**, referenced by `vehicleId` (ADR 0019, D6).
  - A mode-neutral vehicle (`id`, `occupancy`, `seatsLeft`, `isLowFloor`) is declared in `src/shared/`.
  - The bus wire extends it with `plateNumber`, `position` and `trajectory`.
  - Unknown is null, never `false` or `0`.

### D3. The three boards serve calls

These change in one release with the matching app OTA:

- `/bus/live/:groupId` serves calls.
- `/bus/stops/:stopId/arrivals` serves calls for both its live and timetable entries.
- `/subway/stations/:stationId/arrivals` serves calls plus `trainNo` and the neighbor stations, with `generatedAt` at `+09:00`.

`/bus/config` and `/bus/stops` stay additive-only.

### D4. Places

A place is `{ kind, id, name, coords, platformId, action }`:

- **`kind`** is one of `bus_stop`, `bus_stop_area`, `subway_station`, `skku_building` or `point`. The list is open.
- **`id`** is the owning catalog's id verbatim. It is null only for `point`.
- **`platformId`** is the subway platform (KRIC) where the place is boarded or alighted.
- **`action`** is where a tap goes (the shared link action), or null when the place is not tappable.

The rules:

- **One vocabulary.** The kinds are the app's link kinds in `skkuverse-app/packages/shared/src/utils/map-place-ref.rules.ts`, mirrored by the server's `PUSH_PLACE_KINDS` (`src/miniapps/notifications/miniapps-notifications.constants.ts`). That list is not the eventmap's unrelated `PLACE_KINDS`.
  - Kinds are snake_case because the link grammar `^(?:([a-z0-9_]+):)?([a-z0-9-]+)$` is lowercase. Every other enum stays camelCase.
  - A place with an id has the form `<kind>:<id>`.
  - A new kind joins the push and link lists only once the app routes it: app first, then server. The journey wire passes through neither list.
- **Ids.**
  - Each catalog keeps its own ids: the bus-stops slug or a pole's national nine-digit station id (`100900075`; its `seoul-<ARS>` id stays a legacy alias that resolves to it, ADR 0019 D5 amended 2026-10-25), the subway slug, and the SKKU building `_id` as a string.
  - Every place id matches `[a-z0-9-]{1,128}`.
  - A KRIC platform id is uppercase, so it is an attribute, never an id.
- **No second id layer.** An alias never retires an id (ADR 0019, D5, amended), with one exception: an unlisted route's pole exists only through its alias, so that alias cannot be removed while the journey dataset names the pole.
  - A journey response cites ids at plan time and is never persisted.
  - The journey dataset resolves its references through the stop index at push, reading the TOPIS registry and route-path collections, and again on read.
- **Stop areas** follow GTFS `parent_station`, named after Transmodel's `StopArea`, because "station" already means a stop by its route index in the bus module.
  - `bus-stops` gains an optional `stopAreas: [{ id, name, stopIds }]`. Its members are listed on the area, because a TOPIS pole has no catalog entry to carry a parent. Its coords are derived.
  - Push checks: members resolve; a stop belongs to at most one area; an area has at least two members, each within 150 m of the centroid; area ids are disjoint from stop ids.
  - A member that TOPIS drops at runtime is a warning.
  - The wire change is additive: `stopAreaId` on `/bus/stops` entries and on the stop page's `stop`.
  - Areas are for picking a place; pages and pins stay one per stop.
  - The structure ships now, and an area's data is pushed when something cites it.
- **What legs and options cite.**
  - A ride leg's from and to are its board and alight places: a `bus_stop`, or a `subway_station` with its `platformId`.
  - An option's from and to are a `bus_stop_area`, a `skku_building` or a `point`.
  - 정문 is `skku_building:1` at 인사캠 and `skku_building:7` at 자과캠, already building-list facilities.
  - `point` is the user's location only. It has no string form and is never persisted.
- **Coords are required** as `{ lat, lng }`. The journey dataset refuses a cited place that does not resolve to coords.
- **Every subway station a journey boards or alights at is a served station:** polled, listed and tappable, with every line that stops there. That covers 사당 (lines 2 and 4), 금정 (lines 1 and 4) and 종로5가 (line 1). Boards keep three trains per direction.

### D5. Legs, options and routes

Every leg has a base:

- `kind` (open: `ride`, `walk`, `transfer`) and `mode` (open: `shuttle`, `bus`, `expressBus`, `subway`, `walk`);
- `from`, `to`, `startAt`, `endAt`, `basis`, `durationSec`, `distanceM`;
- server-made `label`, `icon` and `color`.

A client that does not know a kind draws a generic row from the base. It draws an unknown mode or icon with the generic icon, and ignores unknown fields.

A ride leg adds:

- `line { id, name }`, `board`, `alight`, `later` (at most two next catchable calls);
- `vehicles` keyed by the calls' `vehicleId`s;
- `waitSec`, `observedAt` (the source document's write time).

A ride leg's `startAt` and `endAt` are its calls' times. Its `basis` is the weaker of its two calls, in the order timetable, provider, estimate. Walk legs add an optional `path`; their evidence stays in the dataset. An option is `{ id, name, mode, status, reason, nextServiceAt, leaveAt, arriveAt, legs, warnings }`, with open warning codes. Certainty is shown per leg and through `later` and `warnings`, never as one journey score.

- Amended 2026-10-25 (owner): a ride leg's `startAt` is its board call's time, departure first, as D2 orders it, and its `endAt` is its alight call's arrival first (`expectedArrivalAt`, then `scheduledArrivalAt`), falling back to its departure, since a rider leaves the vehicle when it arrives (GTFS and OTP time a leg the same way). The calls themselves stay as the boards serve them; only the leg's instants, the option's `arriveAt` and the next leg's start follow the arrival.
- Amended 2026-10-25 (PR (h)): a ride boards at its board call's time or, when later, at the call's expected arrival (`toBoardTime`), since a run running late leaves no earlier than it arrives. A live subway call keeps its timetable departure beside its expected arrival, so D2's order alone would board a late train at its timetable time. Every other producer's board call carries no expected arrival beside a departure, so its board time is D2's.

A new mode adds a kind only when it needs different required fields. Taxi will add `taxi`, its fare and its pickup wait, with times from a travel-time source fed by a poller over fixed pairs ([ADR 0012](0012-runtime-roles.md), D2). The wire carries no reserved, unserved kind.

### D6. Producers are doors over a shared interface

`src/shared/` declares a departure query, departure board and `DepartureSource` interface (the 2026-10-24 plan's Shape C):

- `bus/departures/` holds one sub-module per source (timetable, TOPIS, HSSC), so each stays within the four-dependency constructor cap.
- `subway/timetable/departures/` covers the subway.
- The journey registry maps a dataset source id to a door.
- One `toCall` in `src/shared/` maps the domain call for the boards and the journey.

A stored field a new release adds is optional on read, because api replicas deploy before the poller (ADR 0012, D3). The planned route is cached per route and language with single-flight, for at most 5 seconds. The client refetches every 15 seconds (`private, max-age=15`). The planner reads only MongoDB.

## Consequences

- (An agent tooling note is left out of the public history.)
- Adding something later takes this much work:
  - A line of a polled source, or a stop area: data only (`journey-routes` or `bus-stops`).
  - A subway station or line: a code entry plus the topology and timetable data, the tracker stretch and the poller ceiling.
  - Another Gyeonggi bus: a `REGIONAL_ROUTES` entry and TOPIS quota. Its seats need the GBIS operating account, because 7800 already spends up to 867 of the development account's 1,000 calls a day.
  - Taxi: a new kind plus the travel-time source.
- The subway poller grows by 사당, 금정 and 종로5가; the call-volume arithmetic in the subway API reference moves with it.
- The bus and subway module docs sit at their 200-line caps, so this ADR holds the shared glossary: call, run, run id, stop area.

### D7. PoC behavior (owner, 2026-10-25)

- **Options.** 인사캠 정문 (`skku_building:1`) ↔ 자과캠 정문 (`skku_building:7`), with four options each way:
  - 인자셔틀;
  - 4호선 → 금정 → 1호선;
  - 종로08 → 종로5가 → 1호선;
  - 4호선 → 사당 → 7800.
  The ends between 정문 and 혜화역, 성균관대역 or the 7800 stops are walks. The HSSC shuttle as a first mile is a later option. Options are sorted by arrival, with no "fastest" flag; the app decides emphasis.
- **인자셔틀.** Every run, regular and 학부대학 alike: anyone may board either.
- **Realtime reach.** A bus leg uses the upstream's predicted vehicles (TOPIS: two per stop) and nothing past them.
  - When no predicted vehicle is catchable, the leg names no vehicle.
  - Its boarding is the arrival at the stop plus half the headway, from the TOPIS `term` the poller stores.
  - It carries `basis: estimate`, and the app shows it as approximate ("약").
- **Full buses.** A vehicle with `seatsLeft: 0` is skipped. Null seats count as boardable, because 7800 seats no standing riders.
- **Departure time.** "Now" only; the departure query already takes a `from` for a later picker.
- **No service.** An option with no run left reports `notRunning` with `reason: ended` and the next first departure (`nextServiceAt`). The timetable gives it for shuttles and the subway. The stored TOPIS `firstTm` gives it for buses.
  - Amended 2026-10-25 (PR (h)): when that next departure falls later the same KST date as now (before the day's first run, or past a gap longer than the plan's window), the reason is `notStarted`; on a later date, or unknown, it stays `ended`. The value is additive: the app draws a reason it does not know as `ended`.- **Walk minutes.** `journey-routes` values with evidence, measured at data-authoring time from TMAP pedestrian routes. That is a one-off call by a person, never one the api makes. Key walks can be replaced by on-site measurements later.
- **Language and taxi.** Labels come in ko, en and zh, like the stop catalog. Taxi stays out of the PoC.
- **Fares.** None in the PoC. Summing leg fares would be wrong under 수도권 통합환승, so a per-option `fare` is added later as data.
- **New subway stations are listed.** 사당, 금정 and 종로5가 appear in `/subway/stations` and app search like any served station, with no campus.
- **Accuracy.** Not logged yet; the estimates stay rule-based.

## Related

- [ADR 0010](0010-server-architecture.md), [ADR 0012](0012-runtime-roles.md), [ADR 0013](0013-runtime-data-in-mongodb.md), [ADR 0017](0017-subway-arrivals.md), [ADR 0019](0019-bus-live-api.md)
- [transit-route-planner.md](../plans/transit-route-planner.md): the implementation plan: the planner, the dataset and the PR sequence
