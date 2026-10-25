---
title: Transit Route Planner
type: plan
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-10-25
audience: internal
---

# Transit Route Planner

> How [ADR 0022](../decisions/0022-journey-and-call-spec.md) gets built: the PR sequence from the shared call to 길찾기's four options each way, the `journey-routes` dataset that makes a route a data push, how each source fills the call, the source doors and the planner over them, the `journey/` module, the PoC options leg by leg, and the subway coverage the options need. The ADR is the spec (the call, places, legs, options, producers, the owner's PoC decisions in D7); this file is the work. Status on 2026-10-25: (a) to (g) are in production (PR #342), serving `journey-routes` revision 3's eight options; (h) is built and needs no dataset change.

## Scope

- **In.** 인사캠 정문 (`skku_building:1`) ↔ 자과캠 정문 (`skku_building:7`), four options each way (ADR 0022, D7): 인자셔틀; 4호선 → 금정 → 1호선; 종로08 → 종로5가 → 1호선; 4호선 → 사당 → 7800. The three departure boards reshaped to the call (D3). 사당 (lines 2 and 4), 금정 (lines 1 and 4) and 종로5가 (line 1) served (D4).
- **Out.** Taxi, fares, a departure-time picker (the query already takes `from`), the HSSC shuttle as a first mile, stop-area data (the structure is the stop session's; no PoC option cites an area), accuracy logging.
- (An agent tooling note is left out of the public history.)

New files are written relative to `src`, without its prefix, because docs cite only `src/` paths that exist (`__tests__/architecture/paths.test.ts`).

## Where things stand

Verified against `src/` on 2026-10-25:

| Source | Today | What the plan adds |
| --- | --- | --- |
| TOPIS (종로 02, 07, 08 and 7800) | `JONGRO_ROUTES` and `REGIONAL_ROUTES` in `src/bus/bus.constants.ts`; 7800 is `gyeonggi7800`, unlisted, polled every 30 s behind `REGIONAL_BUS`; seats from GBIS (`src/bus/realtime/gbis/`, `vehicle.seatsLeft`, ADR 0019 D17); stops `nsc-skku-to-sadang`, `nsc-skku-to-suwon`, `sadang-exit9`, `sadang-median` | The call shape, `term` and per-station `firstTm`/`lastTm` stored, a door |
| Timetabled shuttles | `BusEtaSmartService.listRuns` (`src/bus/eta/smart/bus-eta-smart.service.ts`) gives each run's stop instants; the stop page reads it | The scheduled pair kept beside an estimate, `isFirstRun`, `runId` and `headsign` served, a door |
| HSSC shuttle | ADR 0018's engine, served on `/bus/live/hssc` | The call shape only; its door comes with the HSSC first-mile option |
| Subway | `/subway/stations/:stationId/arrivals` (`src/subway/arrivals/subway-arrivals.wire.ts`): UTC `Z` instants, `source`, a `stopsAway` that is 0 approaching or standing; stored trains (`src/subway/subway.document.ts`) carry no timetable time; `SUBWAY_STATIONS` (`src/subway/subway.constants.ts`) serves 혜화 and 성균관대 for the PoC lines | Three served stations, the per-train timetable time stored, the call shape, a door |
| Journey | Nothing | `journey/`, the `journey-routes` dataset, `GET /journey/routes` |

## PR sequence

Every PR is test-first with `the test-first workflow` (ADR 0011, D9). (a) to (c) land on `dev` and wait there: `main` gets them together in (d), because they reshape the boards the installed app parses. From (e) on, each PR merges to `dev`, ships and is checked live before the next (pstack shipping).

| PR | Change | What it proves |
| --- | --- | --- |
| (a) | **Shared declarations and the bus boards as calls, server side.** `shared/call.wire.ts` (the call), `shared/call.types.ts` (its domain twin; `StopCall` moves there from `src/bus/bus.types.ts`), `shared/vehicle.wire.ts` (`id`, `occupancy`, `seatsLeft`, `isLowFloor`), `instant` and `latLng` declared once, and `toCall` in `shared/call.util.ts`. `/bus/live/:groupId` and `/bus/stops/:stopId/arrivals` serve calls: `isLastBus` leaves the arrival and the vehicle for the call's `isLastRun`; `runId`, `headsign`, `isFirstRun` and `isExpress` (null) are served; the shuttle's scheduled pair stays beside its estimate; the bus vehicle extends the shared base with `plateNumber`, `position` and `trajectory`. `contracts/produced/` regenerated | Both bus boards serve one call shape through one `toCall`; the stop-calls and bus-stops characterization tests change only in the fields named here; `contracts/produced/` changes only in them |
| (b) | **Served subway stations and the subway's producer data.** 사당 (lines 2 and 4), 금정 (lines 1 and 4) and 종로5가 (line 1) in `SUBWAY_STATIONS`, with no campus; the `subway-topology`, `subway-station-coords` and `subway-timetables` data and the tracker stretches they need ([Subway coverage](#subway-coverage)); the poller ceiling arithmetic. The tracker stores each train's timetable time (optional on read); the rules for the C4 `stopsAway` (ADR 0022, D2) and `isLastRun` (the last train of its direction at the platform on the service day's table) | `/subway/stations` lists the three and their arrivals serve; 혜화's and 성균관대's arrivals are unchanged by the wider tables; rules specs pin C4 and `isLastRun` over captured fixtures; a stored document without the new field still serves |
| (c) | **The subway board as calls.** `/subway/stations/:stationId/arrivals` serves calls plus `trainNo` and the neighbor stations, with `generatedAt` at `+09:00`; `live`, `estimated` and `scheduled` become `provider`, `estimate` and `timetable` | The subway contract carries the shared call; a train's instants equal the old ones at second precision, with `+09:00` and no milliseconds |
| (d) | (An agent tooling note is left out of the public history.) | Live `/bus/live/jongro08`, a stop page and `/subway/stations/hyehwa/arrivals` parse in the updated app; a bundle that has not applied the OTA degrades as ADR 0022's Consequences say, and nothing else |
| (e) | **`journey/` with the 인자셔틀.** The `journey-routes` dataset (schema, push checks, the catalog entry with `referencesOf` and the `recheckOn: ["bus-stops"]` hook), place resolution, the registry with the bus timetable door (`bus/departures/timetable/`), the planner, the per-route cache and `GET /journey/routes`; `docs/explanation/journey-architecture.md`; the api-role boot test gains the module. Push the two 인자셔틀 options, walks measured with TMAP | The 인자셔틀 leg's board and alight calls equal the stop page's calls for the same `runId` at `hssc-bus-lot` and `nsc-n-center`; the push refuses an unresolved reference, a place without coords, an empty evidence and a reversed stop pair, and a `bus-stops` push that drops a cited pole |
| (f) | **The subway door and the 4호선 options.** `subway/timetable/departures/` over the timetable, its registry entry; push 4호선 → 금정 → 1호선 both ways | A subway leg's board and alight calls equal the timetable's times for the same train at both platforms; the 남태령 train-number join is settled ([Probes](#probes)) |
| (g) | **The TOPIS door, 종로08 and 7800.** `bus/departures/topis/`; the Jongno poller stores `term` per route and `firstTm`/`lastTm` per station (optional on read); boarding past the two predicted vehicles at the rider's arrival plus half of `term`; a vehicle with `seatsLeft: 0` skipped; `nextServiceAt` from `firstTm`. Push 종로08 → 종로5가 → 1호선 and 4호선 → 사당 → 7800, both ways | The 사당 boarding call equals `/bus/live/gyeonggi7800` at `sadang-exit9` for the same vehicle, and a 종로08 board equals `/bus/live/jongro08` at `100900046`; a leg past both predicted vehicles names none and carries `basis: estimate`; a stored document without `term` serves with no extrapolation |
| (h) | **Subway realtime first legs, `later` and `warnings`.** The subway door boards from the platform's stored arrivals when its catchable train is among them; ride legs fill `later` (at most two) and options `warnings` (`tightTransfer`, `connectionAtRisk`) | A first subway leg's board call equals `/subway/stations/hyehwa/arrivals` for the same `runId`; `later` lists the next two catchable calls; a transfer under the threshold warns |

Every key is present from (e). (h) as built, on 2026-10-25:

- **Subway realtime.** The door reads the board platform's calls through `SubwayArrivalsService.listPlatformCalls`, the calls `/subway/stations/:stationId/arrivals` serves, and boards a timetable train the board lists `live` or `estimated` by that call, matched by `runId`, keeping the ride's first and last flags. The train's delay past its timetable arrival there moves its alight call's expected arrival by as much, as an estimate. A stale state or a train past the stored three per direction boards from the timetable. A ride boards at `toBoardTime`, the call's time or its expected arrival when later, since a live subway call keeps its timetable departure (ADR 0022, D5, amended).
- **`later`.** At most the next two catchable listed calls after the boarded one, from every door that lists departures, a full vehicle skipped. A TOPIS headway board carries none: ADR 0022 D7 keeps a bus leg to the upstream's predicted vehicles, and a headway call names no run a rider could let pass, so `later` holds only calls that exist.
- **`warnings`.** See [The planner](#the-planner).
- **No service.** `notStarted` joins `ended` and `unavailable`, and overnight TOPIS hours come from `jongro_routes` (ADR 0022, D7, amended). No `journey-routes` revision is needed.

Caps each PR respects: `src/bus/bus.wire.ts` sits at its size exemption, so (a) moves the call and vehicle out before adding anything; `docs/explanation/bus-architecture.md` and `subway-architecture.md` are at the 200-line module-doc cap, so the shared terms (call, run, run id, stop area) stay in ADR 0022 and a PR that adds a glossary row trims first.

## The `journey-routes` dataset

One dataset document, read whole and small ([ADR 0013](../decisions/0013-runtime-data-in-mongodb.md), D1), validated at push and parsed at read (D5, D6). It holds lines and routes. Places are not copied in: legs cite them as `<kind>:<id>` refs that resolve through the owning catalogs, which supply the name, the coords and the tap action.

### Schema

```ts
// journey/journey.document.ts (the stored shape; zod in journey/journey.schema.ts)
type LocalizedName = Readonly<Record<SupportedLang, string>>; // ko, en, zh
type PlaceRef = string; // "<kind>:<id>": "bus_stop:hssc-bus-lot", "subway_station:hyehwa", "skku_building:1"

interface JourneyRoutesData {
  catchMarginSec: number; // reach a boarding stop this long before its call; 60 in the PoC
  lines: JourneyLine[];
  routes: JourneyRoute[];
}

interface JourneyLine {
  id: string;                // [a-z0-9-]{1,128}
  source: JourneySourceId;   // "busTimetable" | "topis" | "subway"; JOURNEY_SOURCE_IDS
  sourceLineId: string;      // the source's own: "campus-inja", "jongro08", "gyeonggi7800", "4"
  mode: "shuttle" | "bus" | "expressBus" | "subway";
  name: LocalizedName;       // the ride leg's label
  color: string;             // hex6 without '#'
  icon: string;              // an open key; the app draws an unknown one with the generic icon
}

interface JourneyRoute {
  id: string;
  name: LocalizedName;
  from: PlaceRef;            // skku_building or bus_stop_area
  to: PlaceRef;
  options: JourneyOption[];  // data order breaks an arrival tie
}

interface JourneyOption {
  id: string;
  name: LocalizedName;
  mode: "shuttle" | "bus" | "expressBus" | "subway"; // the option's icon
  legs: JourneyLeg[];        // the first leg starts at the route's from, the last ends at its to
}

type JourneyLeg =
  | { kind: "walk"; from: PlaceRef; to: PlaceRef; minutes: number; distanceM: number; evidence: string; path?: LatLng[] }
  | { kind: "transfer"; at: PlaceRef; fromPlatformId: string; toPlatformId: string; minutes: number; evidence: string }
  | {
      kind: "ride";
      line: string;          // a line id
      board: LegStop;
      alight: LegStop;
      rideMinutes: number;   // used only when the door cannot place the run at the alight stop
      rideMinutesBands?: { weekday?: Band[]; weekend?: Band[] }; // rideMinutes by the board's KST time of day
      evidence: string;      // where rideMinutes comes from
    };

interface Band {
  from: string;              // KST "HH:mm"; the band runs until the next band's from, the last until midnight
  minutes: number;
}

interface LegStop {
  place: PlaceRef;           // bus_stop, or subway_station
  platformId?: string;       // the KRIC platform; required on a subway_station
}
```

- **Place refs.** The kinds are ADR 0022 D4's (`bus_stop`, `bus_stop_area`, `subway_station`, `skku_building`; `point` is the user's location and never stored). The id is the owning catalog's verbatim: a `bus-stops` slug or a pole's nine-digit station id (`100900046`; `seoul-<ARS>` is a legacy alias that resolves to it), a `SUBWAY_STATIONS` slug, a building `_id` as a string. A KRIC platform id is uppercase, so it is `platformId`, never an id.
- **Walk and transfer legs.** A walk joins two places; a transfer is a change between two platforms of one station (금정's line 4 to line 1). A walk between a station and a bus stop (사당, 종로5가) is a walk.
- **Walk minutes and evidence.** Measured once, at data-authoring time, by a person running TMAP pedestrian routing between the two places' coords; the api never calls it (ADR 0022, D7). `evidence` names the source and date (`TMAP pedestrian 2026-10-2x, 412 m`), and `distanceM` and an optional `path` come from the same answer. A key walk measured on site later replaces it with that evidence. Transfer minutes and fallback ride minutes carry evidence the same way. Since revision 4 (owner, 2026-10-25) these rough real-world numbers come from Naver Map's transit directions, read in a browser, which include the walk inside a station to and from the platform.
- **Ride minutes by time of day.** A ride whose duration swings with traffic (7800: 28 to 50 min) carries `rideMinutesBands`, per day type: `weekday`, or `weekend` for a Saturday, a Sunday or a public holiday. A band runs from its `from` (KST `HH:mm`) until the next band's, the last until midnight; the board's KST time picks one, and outside every band the flat `rideMinutes` applies. The push refuses bands out of order, at one time or at a malformed time. Bands come from Naver's per-stop schedule sampled through the day, and their evidence says when.
- **Labels.** A ride leg's `label` is its line's name in the request language; walk and transfer labels are i18n keys in `src/infra/i18n.ts`. Names of places come from their catalogs, never from this dataset.
- **Why this fits ADR 0013 D2.** The planner branches on no route, option, line or place, so all four are data. A source's own identities (TOPIS route ids, shuttle service ids, KRIC platforms) stay in code; the dataset only names them.

### Push checks

`toJourneyRoutesIssues` in `journey/journey.rules.ts`, declared in `scripts/lib/datasets/catalog.js`, refusing on any issue. The catalog gathers the identity sets from `dist/` (bus constants, `SUBWAY_STATIONS`) and the stored datasets and collections, and passes them to the pure rule, so `journey/` imports no other feature's constants.

| Check | Against |
| --- | --- |
| Route, option and line ids match `[a-z0-9-]{1,128}`; route and line ids are unique, and option ids unique within their route; every place ref is `<kind>:<id>` with a known kind and an id matching `[a-z0-9-]{1,128}` | the dataset |
| Legs chain: each starts where the previous ended, the first at the route's `from`, the last at its `to`; every ride leg's line resolves | the dataset |
| Every ref resolves: `bus_stop` through the stop index (the `bus-stops` dataset through `storedOf`, the stored `jongro_routes` registry and route paths), `subway_station` and its `platformId` through `SUBWAY_STATIONS` (a platform of that station, on the ride line's `sourceLineId`), `skku_building` through `buildings`, `bus_stop_area` through `bus-stops` `stopAreas` | the stored datasets and collections of the target environment |
| Every cited place resolves to coords: `bus-stops` coords or a registry pole's, the `subway-station-coords` dataset, the building's | the same |
| A ride leg's board precedes its alight on its line: `busTimetable`, the service's `bus-stops` sequence (board a boarding stop, alight an alighting one); `topis`, the stored registry's station order in one direction; `subway`, a train of every day type in the stored `subway-timetables` calls at both platforms in order | the same |
| Minutes and `distanceM` are positive integers below a sanity bound; every `evidence` is non-empty; `catchMarginSec` is from 0 to 300 | the dataset |
| Every cited pole of an unlisted route (7800's four) is still served, through its `bus-stops` alias | `storedOf("bus-stops")` and the registry, rechecked on every `bus-stops` push |

The catalog entry, per the design addendum of 2026-10-25:

- **`referencesOf`** returns `{ dataset: "bus-stops", id }` for every cited stop and stop area the `bus-stops` dataset holds, so its existing incoming-reference check refuses deleting one; a nine-digit pole resolves through the registry in `issuesOf` instead.
- **`recheckOn: ["bus-stops"]`** reruns `issuesOf` against a pushed `bus-stops`, so removing an alias that is the only way to a cited 7800 pole is refused (ADR 0022, D4: the one exception to "an alias never retires an id"). The hook's final name is the stop session's.
- **`reads: ["subway-timetables"]`**, since that dataset is parted, and `collections` for the registry, the route paths and `buildings`. `idsOf` returns nothing: no dataset references journey routes.

### Adding a route later

A route or option over sources the server already reads, or a line of one (another 종로 route, another served subway line): data only.

1. `npm run data -- pull journey-routes`.
2. Add the line and the route or option, each walk measured with TMAP and its evidence written.
3. `npm run data -- push journey-routes` to `_dev`, check `GET /journey/routes`, then `push --prod`. Every replica serves it within a minute (ADR 0013, D6).

A subway station the dataset does not yet cite must be served first (ADR 0022, D4), which is code ([Subway coverage](#subway-coverage)). A new upstream is one door plus its id in `JOURNEY_SOURCE_IDS`: `tsc` then fails until the registry maps it.

## How each source fills the call

The call is ADR 0022 D2's. Every producer fills it from stored state and a `now` it is given, never from a wire; `toCall` (`shared/call.util.ts`) formats it for the boards and the journey alike.

| Field | TOPIS live (종로, 7800) | TOPIS past the predicted vehicles (journey only) | Timetabled shuttle | Subway, live or estimated | Subway, timetable only | HSSC engine |
| --- | --- | --- | --- | --- | --- | --- |
| `status` | From `arrmsg` and the vehicle's position: `arriving`, `enRoute`, `waitingToDepart`, `unknown` (ADR 0019, D14) | `unknown` | `scheduled` | `arriving` approaching or arrived here, else `enRoute` | `scheduled` | As `/bus/live/hssc` today |
| `expectedArrivalAt` | `mkTm + traTime` (ADR 0019, D1) | The rider's arrival at the stop plus half of `term` | The run's estimate at an alighting stop (NAVER live, TMAP baseline or the bus-lane model), else null | The stored `arrivalAt` | null | The engine's |
| `expectedDepartureAt` | null (D14) | null | The run's estimate at a boarding stop, else null | null | null | null |
| `scheduledArrivalAt` | null | null | The timetable time at an alighting stop, kept beside the estimate from (a) | The train's timetable time at this platform, stored from (b); null on a document written before it | The timetable time | null |
| `scheduledDepartureAt` | null | null | The timetable time at a boarding stop | The timetable's departure where it lists one | The same | null |
| `basis` | `provider` | `estimate` | `timetable`, or `estimate` once an estimate fills the expected pair | `provider` for `live`, `estimate` for `estimated` | `timetable` | `estimate` |
| `stopsAway` | As `/bus/live`: stopping stations before this one plus one, pass-through stations skipped (ADR 0019, D4) | null | null | C4 (ADR 0022, D2) from the stored position, from (b) | null | The engine's |
| `runId` | null | null | `serviceId\|routeType\|date\|HH:mm` | `<line>/<serviceDate>/<trainNo>`, the timetable's train number | The same | null |
| `vehicleId` | TOPIS `vehId` | null | null | null | null | The Shuttle bus id |
| `headsign` | The direction's terminal, the route-path `direction` (ADR 0019, D16) | The same | The service's direction label | The destination | The same | 등교 or 하교 (D16) |
| `isFirstRun` | null | null | The first run of the day at this stop | `isFirstTrain` | The same | null |
| `isLastRun` | TOPIS `isLast1`/`isLast2` | null | The last run of the day at this stop (`isLastOfDay`) | The last train of its direction at this platform on the service day's table, from (b) | The same | The HSSC last-bus flag |
| `isExpress` | null | null | null | `express` | The same | null |
| `providerText` | `arrmsg`, as received | null | null | null | null | null |

Rules the doors share:

- **The time of a call** is the first non-null of expected departure, scheduled departure, expected arrival and scheduled arrival (D2). The planner compares calls only by it.
- **On a ride leg's board, `isLastRun` means the last run that reaches the alight stop.** The timetable doors compute it from runs calling at both stops in order; on TOPIS, a route's last bus passes every later stop, so the board's flag holds. The journey's 인자셔틀 line spans every route type (regular and 학부대학, D7), so its last run is the day's last across them, while the boards keep theirs per route type.
- **A ride leg's `basis`** is the weaker of its board and alight, in the order timetable, provider, estimate (D5). An alight time taken from `rideMinutes` is `estimate`.
- **Vehicles.** A ride leg's `vehicles` are the shared base, keyed by the `vehicleId`s of its board, alight and `later` calls. `seatsLeft` comes from the GBIS read `/bus/live` uses; unknown is null, never 0.

## Producers

### The shared interface

`shared/departure.types.ts` and `shared/departure.error.ts` land in (e), with their first reader (knip refuses an unread file):

```ts
export interface DepartureQuery {
  lineId: string;              // the source's own line
  boardStopId: string;         // a stop id or a KRIC platform id
  alightStopId: string | null; // null: a board with no destination
  from: Date;
  until: Date;
}

export interface Departure {
  lineId: string;
  board: StopCall;             // the domain call, shared/call.types.ts
  alight: StopCall | null;     // the same run at the alight stop; null when the source cannot place it there
  observedAt: Date;            // the source document's write time
}

export type DepartureContinuation =
  | { kind: "listed" }                                             // nothing runs in the window beyond the list
  | { kind: "headway"; headwaySec: number; serviceEndsAt: Date | null }; // TOPIS term: later vehicles every N seconds

export interface DepartureBoard {
  departures: readonly Departure[];          // by call time, ascending
  vehicles: Readonly<Record<string, Vehicle>>; // keyed by the calls' vehicleIds
  continuation: DepartureContinuation;
  nextServiceAt: Date | null;                // the next first run when the window lists none
}

export interface DepartureSource {
  listDepartures(query: DepartureQuery): Promise<DepartureBoard>;
}
```

- **The alight call is joined inside the door, by `runId` or `vehicleId`.** Only the source knows its runs. The planner never joins; it reads `alight` or falls back to `rideMinutes`.
- **A source with nothing usable throws `DepartureUnavailableError`**: no stored document, a missing dataset. An empty `listed` board is not an error but "no service in the window".
- **Stored fields a release adds are optional on read** (ADR 0012, D3): the subway's per-train timetable time, TOPIS `term`, `firstTm` and `lastTm`. Absent, they serve null and the planner does without them (no extrapolation, no `nextServiceAt`).

### The doors

| Door | Folder | Reads | Lands |
| --- | --- | --- | --- |
| `BusDeparturesTimetableService` | `bus/departures/timetable/` | `BusEtaSmartService.listRuns`, the service's `bus-stops` sequence | (e) |
| `BusDeparturesTopisService` | `bus/departures/topis/` | `BusLiveGroupService.findLiveGroup` (the calls, vehicles and GBIS seats `/bus/live` serves), `BusRealtimeJongroService.findArrivalsEntry` (the stored row's `term`, `firstTm`, `lastTm`), `BusStopIndexService` (stop id to station index) | (g) |
| `BusDeparturesHsscService` | `bus/departures/hssc/` | ADR 0018's engine | with the HSSC first-mile option |
| `SubwayTimetableDeparturesService` | `subway/timetable/departures/` | `SubwayTimetableService` for both platforms, `CalendarService` for the day type; from (h), the board platform's calls through `SubwayArrivalsService.listPlatformCalls`, the station board's own, as the TOPIS door reads `/bus/live`'s | (f), (h) |
| `JourneyDeparturesService` (the registry) | `journey/departures/` | the doors, by the line's `source` | (e) |

- `bus/departures/` is a root with one sub-module per source (ADR 0022, D6), so each door stays within the four-dependency constructor cap and a sibling's service is all it imports.
- `JOURNEY_SOURCE_IDS` is one `as const` list in `journey/journey.constants.ts`; `JourneySourceId`, the dataset schema's enum and the registry's `Record` derive from it.
- Each door is injected as its concrete class (ADR 0010, D1); `implements DepartureSource` is a compile-time check.
- **TOPIS's window.** The door lists the predicted vehicles at the board station (two per stop) and nothing past them. With `term` stored it answers `continuation: headway` until `lastTm`; with every slot 운행종료 or past `lastTm`, an empty `listed` board and `nextServiceAt` from `firstTm` on the next service day. The alight call is the same `vehId`'s slot at the alight station when TOPIS names it there, else null.
- **Subway's join.** Board and alight come from the service day's tables for both platforms, joined by train number; a train is listed only when it calls at both in order. Where the two platforms are in different operators' tables (line 4 across 남태령, line 1's Seoul Metro section), the join depends on [Probes](#probes).

## The planner

Pure, in `journey/routes/journey-routes.rules.ts`, over one route, one board per distinct leg query and the time:

```text
t = now; walkedBeforeFirstRide = 0
for leg in option.legs:
  walk | transfer: t += leg.minutes; before the first ride: walkedBeforeFirstRide += leg.minutes
  ride:
    board = boards[leg]                       DepartureUnavailableError → notRunning, reason "unavailable"
    readyAt = t + catchMargin
    catchable = departures with timeOf(board call) >= readyAt
                and the boarded vehicle's seatsLeft != 0       (null counts as boardable)
    dep = first catchable
    none, and continuation is headway and readyAt < serviceEndsAt
        → a call at readyAt + headwaySec / 2: status unknown, basis estimate, no vehicle
    none otherwise → notRunning, nextServiceAt = board.nextServiceAt,
        reason "notStarted" when that falls later in the same service day (from 03:00 KST), else "ended"
    alightAt = timeOf(dep.alight) ?? timeOf(dep.board) + leg.rideMinutes
    later = the next two catchable listed departures after dep, never a headway call
    after an earlier ride: warn by this ride's waitSec (tightTransfer, connectionAtRisk)
    leaveAt ??= max(now, timeOf(dep.board) - walkedBeforeFirstRide - catchMargin)
    t = alightAt
arriveAt = t
```

- Every ride leg boards the first vehicle the rider can catch after the previous leg, never "the next one now". The legs before the first ride are timed back from its boarding, so `leaveAt` is when to leave and their `startAt` follows it.
- `waitSec` is the boarding time minus when the rider is ready at the stop.
- **Realtime reach** (D7): a bus leg uses the upstream's predicted vehicles and nothing past them, then the half-headway call, shown as approximate ("약") because its basis is `estimate`. A subway leg past the stored trains boards from the timetable.
- **Full buses** (D7): `seatsLeft: 0` skips the vehicle; null seats count as boardable, since 7800 seats no standing riders.
- **No service** (D7): an option with a leg that has no run left is `notRunning` with `nextServiceAt`, the next first departure of that leg, and `reason: notStarted` when that falls later in the same service day as now, else `ended`. A service day runs from 03:00 KST (`SERVICE_DAY_START_MS`), so from the last run until 03:00 an option reads `ended` (운행종료) with the morning's first run, as Korean transit apps show it (owner, 2026-10-25).
- **Order.** Running options by `arriveAt`, data order breaking a tie, then the others in data order. No "fastest" flag: the app decides emphasis.
- **`warnings`** (from (h)), open codes, `{ code, message }`, the message naming the next ride's board place in the request language. The slack is the next ride's `waitSec`: its board minus the rider reaching its stop after the previous ride's alight and the walks between. The first ride has no connection.

  | Code | When | Threshold and its evidence |
  | --- | --- | --- |
  | `tightTransfer` | slack under `TIGHT_TRANSFER_SEC` | 120 s. TOPIS predictions 0–3 min out miss by 60–80 s at p90 ([ADR 0014](../decisions/0014-jongro-realtime-from-topis.md)), and the dataset's walks are whole TMAP minutes that leave out the walk inside a station (revision 3's 사당 walk says so), so the 60 s catch margin covers no such miss under 120 s. |
  | `connectionAtRisk` | slack under the uncertainty of the arrival before it, or of a named run's estimated board | `ESTIMATE_UNCERTAINTY_SEC`, 150 s, for an estimated arrival or board: the p90 error of this server's bus estimates at their longest measured horizon, TOPIS 1.5–2.5 min at 3–10 min (ADR 0014) and the HSSC engine 142 s three stops ahead ([ADR 0018](../decisions/0018-hssc-arrival-estimates.md)). Longer rides are unmeasured, so this is a floor. A ride boarded on a TOPIS headway adds half the stored `term`: the bus comes anywhere within the headway, and the estimate sits mid-way. A headway board names no run, so it cannot be missed. |

The routes service is the planner's only caller. It reads the dataset, builds one `DepartureQuery` per distinct `(source, line, board, alight)` over `[now, now + PLAN_HORIZON_MS]` (3 hours), awaits them together, catches each failure into the board map, resolves the cited places, and plans each route.

### Serving `GET /journey/routes`

The wire is ADR 0022 D5's, published to `contracts/produced/` from `journey/routes/journey-routes.wire.ts` (ADR 0010, D13), with `meta.serverNow`.

- **Query.** None in the PoC: both routes are served. A `from` filter is an additive later change.
- **Cache.** The planned route is cached per route and language, single-flight, for 5 seconds (`createCachedLoader`, `src/infra/cached-loader.ts`); the doors read through their modules' cached loaders. `Cache-Control: private, max-age=15` and no ETag: the body is localized and changes every poll.
- **Errors.** The dataset unavailable is `503` with no `Cache-Control` (ADR 0013, D6). A door that fails marks only its options `notRunning` / `unavailable`, logged once per throttle window.
- **Role.** api only reads MongoDB: the dataset, `bus_cache`, the bus schedules and estimates, `subway_arrivals`, `subway-timetables`, the stop and building catalogs (ADR 0012, D1). `__tests__/nest/infra/api-role-boot.test.ts` gains the module, so an api boot that fetches fails.
- **Prefix.** `JourneyModule` owns `/journey` and binds the limiter once (ADR 0010, D7).

## The journey module

```text
journey/
  journey.module.ts       /journey prefix and limiter
  journey.document.ts     JourneyRoutesData
  journey.schema.ts       the dataset's zod, parsed at push and at read
  journey.rules.ts        toJourneyRoutesIssues, the references the catalog declares
  journey.repository.ts   the dataset through createDatasetLoader (src/infra/dataset-loader.ts)
  journey.constants.ts    JOURNEY_SOURCE_IDS, PLAN_HORIZON_MS, PLAN_CACHE_TTL_MS, MAX_LATER_CALLS
  journey.types.ts        JourneySourceId, LegBoards, PlanContext
  departures/             JourneyDeparturesService, the registry
  places/                 JourneyPlacesService: a <kind>:<id> ref to { kind, id, name, coords, platformId, action }
  routes/                 GET /journey/routes: controller, service (cache), rules (the planner), mapper, wire
```

- `places/` reads the stop index (`src/bus/stop-index/bus-stop-index.service.ts`), `SubwayStationsService`, `SubwayStationCoordsService` and `BuildingService` (`src/building/building.service.ts`): four, at the constructor cap. The place wire, `shared/place.wire.ts`, lands here in (e).
- The routes service takes the parent's `JourneyRepository`, `JourneyDeparturesService`, `JourneyPlacesService` and `Clock`.
- `docs/explanation/journey-architecture.md` is written from `_module-template.md` in (e) and joins the MD043 filter in `docs/.markdownlint-cli2.jsonc`. Its glossary holds route, option, leg, line, place ref and catch margin, and cites ADR 0022 for call, run and run id; `corridor`, `itinerary` and `trip` go in Not.

## The PoC options

Both routes, four options each, in data order. Stop ids exist in production today unless marked. Walk minutes are measured with TMAP in the PR that pushes the option.

### 인사캠 → 자과캠 (`hssc-to-nsc`: `skku_building:1` → `skku_building:7`)

| Option | Legs | Pushed in |
| --- | --- | --- |
| `inja` 인자셔틀 | walk → `bus_stop:hssc-bus-lot`; ride `inja` (`busTimetable`, `campus-inja`) `hssc-bus-lot` → `bus_stop:nsc-n-center`; walk → `skku_building:7` | (e) |
| `line4-line1` 4호선 · 1호선 | walk → `subway_station:hyehwa`; ride `line4` (`subway`, `4`) `hyehwa` `S1-4-420` → `subway_station:geumjeong` `KR-4-443`; transfer at `geumjeong` to `KR-1-P149` (1 min, across one island); ride `line1` (`subway`, `1`) `geumjeong` `KR-1-P149` → `subway_station:sungkyunkwan` `KR-1-P153`; walk → `skku_building:7` | (f) |
| `jongro08-line1` 종로 08 · 1호선 | walk → `bus_stop:100900046` (명륜시장.성대후문); ride `jongro08` (`topis`, `jongro08`) → `bus_stop:100900191` (종로5가역.광장시장); walk → `subway_station:jongno-5-ga`; ride `line1` `S1-1-154` → `sungkyunkwan` `KR-1-P153`; walk → `skku_building:7` | (g) |
| `line4-7800` 4호선 · 7800 | walk → `hyehwa`; ride `line4` `S1-4-420` → `subway_station:sadang` `S1-4-433`; walk → `bus_stop:119000302` (sadang-exit9); ride `bus7800` (`topis`, `gyeonggi7800`, mode `expressBus`) → `bus_stop:200000159` (nsc-skku-to-suwon); walk → `skku_building:7` | (g) |

### 자과캠 → 인사캠 (`nsc-to-hssc`: `skku_building:7` → `skku_building:1`)

| Option | Legs | Pushed in |
| --- | --- | --- |
| `inja` 인자셔틀 | walk → `bus_stop:nsc-opposite`; ride `jain` (`busTimetable`, `campus-jain`) → `bus_stop:hssc-600th`; walk → `skku_building:1` | (e) |
| `line1-line4` 1호선 · 4호선 | walk → `sungkyunkwan`; ride `line1` `KR-1-P153` → `geumjeong` `KR-1-P149`; transfer at `geumjeong` to `KR-4-443` (1 min, across one island); ride `line4` → `hyehwa` `S1-4-420`; walk → `skku_building:1` | (f) |
| `line1-jongro08` 1호선 · 종로 08 | walk → `sungkyunkwan`; ride `line1` `KR-1-P153` → `jongno-5-ga` `S1-1-154`; walk → `bus_stop:100900107` (종로5가역.중부교육지원청); ride `jongro08` → `bus_stop:100900004` (명륜시장.성대후문); walk → `skku_building:1` | (g) |
| `7800-line4` 7800 · 4호선 | walk → `bus_stop:200000162` (nsc-skku-to-sadang); ride `bus7800` → `bus_stop:121001315` (sadang-median); walk → `sadang`; ride `line4` `S1-4-433` → `hyehwa` `S1-4-420`; walk → `skku_building:1` | (g) |

- **Lines.** `inja` and `jain` (`busTimetable`, every route type of `campus-inja` and `campus-jain`, D7), `line1` and `line4` (`subway`), `jongro08` and `bus7800` (`topis`). Colors and names follow the boards: 1호선 `0052A4` and 4호선 `00A5DE` as `SUBWAY_LINES` has them.
- **Station slugs.** (b) fixed `sadang`, `geumjeong` and `jongno-5-ga` in `SUBWAY_STATIONS`, and the dataset cites them.
- **The 종로08 poles** come from the stored registry (captured 2026-10-17, `__tests__/nest/bus/fixtures/jongro-registry-routes.json`): outbound seq 4 to 17, back seq 18 to 29.
- **The 7800 poles** are cited by station id, each resolving through the local stop aliasing it (7800 plan PR 3): toward 수원, board `119000302` (`sadang-exit9`, seq 41) and alight `200000159` (`nsc-skku-to-suwon`, seq 58); toward 사당, board `200000162` (`nsc-skku-to-sadang`, seq 24) and alight `121001315` (`sadang-median`, seq 39).
- **Fallback ride minutes** come from the stored timetables (subway) and TOPIS's own times (the captured `traTime` of one vehicle along the ride, and the poles' `firstTm`/`lastTm`), each with its evidence; a door that places the run at the alight stop never reads them. A TOPIS ride reads them whenever TOPIS names the boarded vehicle at only one of its two poles, which is most of the time.

## Subway coverage

ADR 0022 D4 makes every boarded or alighted station a served one, so the PoC's stations get their tables in `subway-timetables` beside the tracker's, like 혜화 and 성균관대. The separate ride-timetable dataset of the 2026-10-24 version of this file is dropped: it existed only because those stations were ridden through, not served.

| Platform | KRIC id | Operator, timetable source | In `subway-timetables` today |
| --- | --- | --- | --- |
| 사당, line 4 | to be filled by (b) (expected `S1-4-433`) | Seoul Metro, `SearchSTNTimeTableByIDService` | No: line 4 is `S1-4-414`..`426` (`LINE4_STATIONS` in `scripts/subway-timetable/convert.py`) |
| 사당, line 2 | to be filled by (b) | Seoul Metro, the same | Within the line 2 stretch (건대입구 212 to 서울대입구 228), not a served platform |
| 금정, line 4 | `KR-4-443` | Korail's section, timed by the Seoul API (station code 1458) | Yes, in the `S1-4-*` tables with 혜화 |
| 금정, line 1 | `KR-1-P149` | Korail xlsx | Yes, within 병점..안양 (`LINE1_STATIONS`), not a served platform |
| 종로5가, line 1 | to be filled by (b) | Seoul Metro's underground section | No: north of 안양 |

What (b) touches, per [subway-architecture.md](../explanation/subway-architecture.md) ("Structure"): the `SUBWAY_STATIONS` entries; the `subway-topology`, `subway-station-coords` and `transit-layout` data in the documented order; `convert.py`'s stretches with each new platform's upstream and watched platforms, and a rerun whose tables are pushed; the specs that pin a platform's line, source and route; and the Seoul API call arithmetic under `config.subway.apiDailyCap`, recorded in [subway-api.md](../reference/subway-api.md).

Two things (b) settles before it pushes:

- (An agent tooling note is left out of the public history.)
- **Unchanged neighbors.** Widening line 4's stretch to 사당 and adding watched platforms must leave 혜화's and 성균관대's arrivals as they are: their characterization is (b)'s first test.

### Probes

- **사당 and 종로5가 on the Seoul API.** Seoul Metro stations should answer `SearchSTNTimeTableByIDService` by station code, as 혜화 does; (b) confirms each code and the KRIC id against the code list.
- **4호선 금정.** Whether the Seoul API answers a Korail-operated line 4 station has been open since 2026-10-20. If not, the Korail xlsx for the 과천·안산선 section is the next source (**Unverified** that it exists in the same format).
- **The train-number join across operators.** Settled in (f) on `subway-timetables` revision 3 (`_dev`, 2026-10-25). 혜화 `S1-4-420` and 금정 `KR-4-443` are both timed by the Seoul API, so they share the `S1-4-*` tables, and a through train is one row under one number across 남태령: weekday 123 trains run 혜화 → 금정 and 124 금정 → 혜화 (Saturday and holiday 106 each way). No through train is left unjoined: the 221 weekday trains at 혜화 alone end short of 금정 (110 at 사당, 1 at 서울역) or run north (110), and the 4 at 금정 alone start there or at 사당, or turn back before 혜화. 금정 `KR-1-P149` and 성균관대 `KR-1-P153` share `KR-1-*`: weekday 134 trains down and 133 up, holiday 127 each way; the 3 weekday trains at 성균관대 alone (express 1902, 1904 up and 1945 down) pass 금정, so the door never boards them for that ride. The door joins within one table by the train's own row and across two by train number, listing a train the alight table numbers apart with no alight call, which the planner fills from `rideMinutes` as `basis: estimate`; no PoC ride crosses two tables.
- **종로5가 in the Korail xlsx.** `KORAIL_ABBREVIATIONS` names only 청량리 and 서울 in the underground section; whether the xlsx lists 종로5가 or it must come from the Seoul API decides its source (**Unverified**).

## Related

- [ADR 0022](../decisions/0022-journey-and-call-spec.md): the spec this plan builds
- [ADR 0010](../decisions/0010-server-architecture.md), [ADR 0012](../decisions/0012-runtime-roles.md), [ADR 0013](../decisions/0013-runtime-data-in-mongodb.md), [ADR 0017](../decisions/0017-subway-arrivals.md), [ADR 0018](../decisions/0018-hssc-arrival-estimates.md), [ADR 0019](../decisions/0019-bus-live-api.md)
- [7800-unified-arrivals.md](7800-unified-arrivals.md): how 7800 joined the TOPIS pipeline, its stops, quota and seats
- [docs/explanation/subway-architecture.md](../explanation/subway-architecture.md): what adding a station touches
- [docs/how-to/edit-runtime-data.md](../how-to/edit-runtime-data.md): pull, push and roll back a dataset
