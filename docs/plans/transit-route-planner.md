---
title: Transit Route Planner
type: plan
status: draft
owner: zoyoong124@gmail.com
last-updated: 2026-10-24
audience: internal
---

# Transit Route Planner

> The design for 길찾기, the map tab's first feature: one departure spec that every bus, shuttle and subway source maps into, routes and lines kept as one dataset so a new route is a data push, a pure planner that chains the first catchable vehicle per leg, the 7800 poller, the subway timetable coverage it needs, and the PR sequence. Nothing here is built yet. This rewrite supersedes the 2026-10-20 version of this file: the taxi option, the 혜화역 → 인사캠 corridor, the `/ui/transit/routes` API and the static options JSON are dropped, and its HSSC segment estimate shipped as [ADR 0018](../decisions/0018-hssc-arrival-estimates.md).

> **Revised 2026-10-24 by [7800-unified-arrivals.md](7800-unified-arrivals.md):** 7800 joins the TOPIS bus pipeline instead of a `journey/` poller, the shared shape is the `/bus/live` `arrival`, and the stop call type keeps its expected and scheduled pairs. Where the two disagree, that file wins until this one is rewritten.

## Scope and owner decisions

Owner, 2026-10-24:

- The PoC serves two routes, 인사캠 → 자과캠 and 자과캠 → 인사캠, each with four options: 인자셔틀; 4호선 혜화 → 금정 → 1호선 성균관대; 종로08 → 종로5가 → 1호선 성균관대; 4호선 → 사당 → 7800. The return route runs each option in reverse.
- Taxi is out.
- **One departure spec for bus and subway, 7800 included.** A new route, or a new line of a source the server already reads, is a data change: a `journey-routes` push with `npm run data` ([ADR 0013](../decisions/0013-runtime-data-in-mongodb.md)), never planner code. A new upstream needs one adapter that conforms to the spec, and nothing else in the planner.
- The app does not compute routes (app ADR 0022, D3). The server serves the plan, and its wire stays close to the app's mock (`campus-routes.types.ts` in skkuverse-app's `features/campus-routes/` of `apps/mobile`).

New files are written relative to `src`, without its prefix, because docs cite only `src/` paths that exist (`__tests__/architecture/paths.test.ts`).

Not in scope: the app's Places segment (`TransitPlace`), GBIS seat counts (the field exists and stays null), the HSSC shuttle and 종로07 adapters (mapped below, built when a route needs them).

## The problem today

Verified against `src/` on 2026-10-24:

| Source | What it serves now | Why the planner cannot use it as is |
| --- | --- | --- |
| Jongno (TOPIS) | `arrival` on `/bus/live`, `+09:00` instants, `basis`, `vehicleId`, at most two per station (`src/bus/bus.wire.ts:57`) | A wire, localized and capped for display. The domain read exists: `BusRealtimeGroupService.findJongroReading` (`src/bus/realtime/group/bus-realtime-group.service.ts:75`) |
| HSSC shuttle | The same `arrival`, from ADR 0018's engine | `BusLiveHsscService.findLiveGroup` answers only the wire `LiveGroup` |
| Timetabled shuttles (인자셔틀, commute) | `"HH:mm"` strings in the smart view (`src/bus/schedule/bus-schedule.wire.ts:11`) | The stop page parses those strings back into instants (`src/bus/stop-arrivals/bus-stop-arrivals.rules.ts`) |
| Subway realtime | `trainArrival`, UTC `Z` instants, at most three per direction (`src/subway/arrivals/subway-arrivals.wire.ts:6`) | A third instant format; served platforms only (혜화, 성균관대) |
| Subway timetable | Internal only: `SubwayTimetableService.findPlatformSchedule` (`src/subway/timetable/subway-timetable.service.ts:83`) | Line 4 covers `S1-4-414`..`426` only (`scripts/subway-timetable/convert.py:150`): no 사당, no 금정. Line 1 covers 병점..안양, which includes 금정 `KR-1-P149` (`convert.py:142`) but not 종로5가 |
| 7800 | Nothing | — |

**F1.** `BusStopArrivalsService` builds the stop page from other routes' response bodies: `BusLiveGroupService.findLiveGroup` (`LiveGroup`) and `BusEtaSmartService.resolveSmart` (`SmartSchedule`, localized). A wire is the domain input there.

Constraints the design honors:

- **ADR 0012, D1 and D2.** An api replica reads MongoDB only. Every upstream call is a poller that writes Mongo.
- **ADR 0010, D9.** A feature imports another feature's `.module` and `.service` only, or `import type`; a sibling sub-module the same (`__tests__/architecture/sub-modules.test.ts`). A constructor takes at most four injected dependencies (`eslint.config.js:160`).
- **Size caps.** `src/bus/bus.wire.ts` is at its exemption (96). `docs/explanation/bus-architecture.md` and `subway-architecture.md` are both at the 200-line module-doc cap (`module-docs`). New code must not grow either module's wire or doc without trimming first.
- **ADR 0013, D2.** Identities the code branches on stay in code. The planner branches on no route, option, place or line, so those are data. A source's own identities (Jongno route ids, shuttle service ids, subway platforms) stay where they are; the dataset only names them.
- **Naming.** "run" is already one timetabled departure (bus glossary, Not `trip`) and one train of a trainset line (subway glossary). The spec keeps "run" for one pass of one vehicle or train along a line, which covers both. "transit" already names `src/ui/transit/` and `src/map/transit/`, so the new feature is `journey/`.

## Usage, from the caller's side

The app's campus sheet asks for the routes from its campus and renders the options in order:

```text
GET /journey/routes?campus=hssc
Accept-Language: ko
→ 200 { meta: { lang, serverNow }, data: { routes: [ { id: "hssc-to-nsc", options: [ …planned options… ] } ] } }
```

Inside the server, the routes flow reads one dataset, asks one registry for each ride leg's departures, and plans:

```ts
const routes = await this.repository.current();                          // journey-routes, 60 s TTL
const boards = await this.departures.listBoards(toQueries(routes, now));  // one DepartureBoard per distinct leg query
return routes.routes.map((route) => ({ route, options: planRoute(route, boards, { now, lines, catchMarginMs }) }));
```

A source answers one question, and every source answers it the same way:

```ts
const board = await busDepartures.listDepartures({
  lineId: "campus-inja",
  boardStopId: "hssc-bus-lot",
  alightStopId: "nsc-n-center",
  from: now,
  until: addMs(now, PLAN_HORIZON_MS),
});
board.departures[0].board.departureAt;   // Date, the run's scheduled departure at 학생회관 버스 주차장
board.departures[0].alight?.arrivalAt;   // Date, the same run's estimated arrival at N센터 앞, basis "estimate"
```

## The departure spec

### Domain type

One file, `shared/departure.types.ts`, about 50 lines (the `.types` cap is 56). It names no feature, so it sits in `src/shared/`, which every feature may import and which imports none (`boundaries/shared`).

```ts
// SEE: docs/plans/transit-route-planner.md ("The departure spec")
export type DepartureBasis = "provider" | "estimate" | "timetable";
export type CallStatus = "arriving" | "enRoute" | "waitingToDepart" | "scheduled" | "unknown";
export type Crowding = "relaxed" | "normal" | "crowded";

/** WHY: a vehicle's call at one stop or platform; a live call carries no departure instant (ADR 0019, D14). */
export interface StopCall {
  stopId: string;              // the source's own stop or platform id
  arrivalAt: Date | null;
  departureAt: Date | null;
  basis: DepartureBasis;
}

export interface BoardingCall extends StopCall {
  status: CallStatus;
  stopsAway: number | null;    // ADR 0019, D4: 1 its next stop, 0 standing here
  providerText: string | null; // QUIRK text as received, for the stop page
}

export interface Departure {
  lineId: string;              // the source's own line id
  runId: string | null;        // one pass of one vehicle or train along the line, stable across its stops
  vehicleId: string | null;    // a physical vehicle; null for a timetable run
  headsign: string | null;     // where it is going, as the source names it
  board: BoardingCall;
  alight: StopCall | null;     // the same run at the alighting stop; null when the source cannot place it there
  isLastRun: boolean | null;
  seatsLeft: number | null;    // 0 cannot be boarded; null unknown (GBIS, later)
  crowding: Crowding | null;
  observedAt: Date;            // when the source produced it: TOPIS mkTm, a poll, a timetable revision's read
}

export type DepartureContinuation =
  | { kind: "listed" }                                                     // nothing runs in the window beyond the list
  | { kind: "headway"; headwayMinutes: number; serviceEndsAt: Date | null }; // later vehicles every N minutes

export interface DepartureBoard {
  departures: readonly Departure[];   // by boarding instant, ascending
  continuation: DepartureContinuation;
}

export interface DepartureQuery {
  lineId: string;
  boardStopId: string;
  alightStopId: string | null;        // null: the stop page, which has no destination
  from: Date;
  until: Date;
}

export interface DepartureSource {
  listDepartures(query: DepartureQuery): Promise<DepartureBoard>;
}
```

Decisions in the type:

- **Instants are `Date` inside the server and `+09:00` strings on every wire**, formatted only by `toKstInstant` (`src/shared/kst-date.util.ts`). The naming rule types an `<event>At` as a `Date` (`.claude/rules/naming.md`), arithmetic needs one, and Mongo stores one natively between the 7800 poller and the api. The subway wire's UTC `Z` instants stay as served; the journey wire uses `+09:00`, like `/bus/live`.
- **`basis` uses ADR 0019's vocabulary**, `provider | estimate | timetable`, not `realtime`. `provider` is the upstream's own prediction (TOPIS, the Seoul subway API); `estimate` is this server's (HSSC engine, shuttle ETA, a delay carried down a train's run, 7800 segment sums, a headway); `timetable` is published. One vocabulary on `/bus/live`, the stop page and the journey wire, and "realtime" would hide that the HSSC times are this server's estimate from live positions.
- **The boarding instant is `board.departureAt ?? board.arrivalAt`.** A timetable run has a departure; a live bus has only its arrival (ADR 0019, D14), and a rider boards when it arrives.
- **The alighting time is joined inside the adapter, by `runId` or `vehicleId`.** Only the source knows its runs: a subway train number, a shuttle run's stop times, a TOPIS vehicle's row at the far stop. The planner never joins; it reads `alight` or falls back to the leg's `rideMinutes`.
- **A source that has nothing usable throws `DepartureUnavailableError`** (`shared/departure.error.ts`, beside `daily-cap.error.ts`): a stale realtime document with no headway to continue from, a missing dataset. An empty `listed` board is not an error: it is "no service in the window".
- **No source id in the type.** The caller already knows which source it asked, so the shared type names no feature. Which source answers a line is the journey dataset's business.

### How each source maps into it

| Source | `lineId` | Stop ids | `board` | `alight` | `runId` / `vehicleId` | `continuation` |
| --- | --- | --- | --- | --- | --- | --- |
| Jongno (TOPIS arrivals in `bus_cache`, read through `findJongroReading`) | `jongro02`, `jongro07`, `jongro08` (`JONGRO_ROUTES`) | `seoul-<arsId>` stop ids, resolved to a station index by the stop index | `arrivalAt` = `mkTm + traTime` (ADR 0019, D1), `basis: provider`, `status` and `stopsAway` as the live route derives them (D4, D14), `providerText` the row's `arrmsg` | the same `vehId`'s slot at the alighting station when TOPIS names it there, else null | `null` / TOPIS `vehId` | `headway` from the row's `term` when the poller stores it (**Unverified**: the arrival row's `term` field is not read today), `listed` with no rows when every slot is 운행종료 (D8) |
| HSSC shuttle (ADR 0018 engine) | `hssc` | the HSSC positions' stop ids in `bus-stops` | the bus's arrival at the position, `basis: estimate`, `status` per ADR 0019 | the same bus's lap time at the alighting position, when it is before the layover | `null` / the Shuttle bus id | `listed` |
| Timetabled shuttles (smart view runs + `shuttle_eta`) | `<serviceId>` or `<serviceId>/<routeType>` (`campus-inja`, `campus-jain/regular`) | `bus-stops` stop ids of the service's sequence | `departureAt`: the run's time at a `board` stop, `basis: timetable`, `status: scheduled` | `arrivalAt`: the run's estimate at the `alight` stop (`basis: estimate`, NAVER live, TMAP baseline or the bus-lane model), else its timetable time | `<serviceId>/<date>/<routeType>/<HH:mm>`, the existing run slot (`runSlotOf`) / `null` | `listed`; a suspended or non-operating day lists nothing |
| Subway timetable (`subway-ride-timetables`, below) | `1`, `4` | KRIC platform ids (`KR-1-0153`, `S1-4-420`) | `departureAt` at the boarding platform, `basis: timetable` | `arrivalAt` of the same train at the alighting platform | `<line>/<serviceDate>/<trainNo>` / `null`; `headsign` the destination | `listed` (the day's table) |
| Subway realtime (`subway_arrivals`, served platforms) | as above | as above | for a train in the platform's stored arrivals, by `trainNo`: `arrivalAt` from the stored train, `basis` `provider` (`live`) or `estimate` (`estimated`) | the timetable arrival plus the same train's delay at the boarding platform, `basis: estimate` | as above | as above |
| 7800 and later TOPIS routes (`journey_topis_arrivals`) | the journey line's TOPIS route id (`200000150`) | TOPIS `stationId`s the line entry lists | `arrivalAt` = `mkTm + traTime`, `basis: provider` | the same `vehId` at the alighting station when TOPIS names it there (`provider`); else the sum of the live segment times between the two stops (`estimate`); else null | `null` / TOPIS `vehId` | `headway` from the stored `term` (**Unverified** for a Gyeonggi route) until the line's service window ends |

Seats and crowding: `seatsLeft` stays null everywhere in the PoC. `crowding` is filled on Jongno from the existing passenger-count rule, and never on a Gyeonggi route, whose `reride_Num` TOPIS leaves at `0` (recorded in the 2026-10-17 capture).

### The source adapters

Each source's adapter is the door service of the feature that owns its data, so the code that knows what a run is maps it. The planner owns the registry that picks the door.

| Adapter | Folder | Reads | Constructor (at most four) |
| --- | --- | --- | --- |
| `BusDeparturesService implements DepartureSource` | `bus/departures/` (new sub-module of bus) | `BusRealtimeGroupService.findJongroReading`, a new domain read of the smart view's runs, `BusStopIndexService`; HSSC later | three services, no `Clock`: the query carries the time |
| `SubwayTimetableDeparturesService implements DepartureSource` | `subway/timetable/departures/` (child of timetable, so it reuses the parent's `Timetable` schema and `toScheduledTrains`) | the `subway-ride-timetables` dataset, `subway_arrivals` through the subway root repository, `CalendarService` for the day type | repository, root repository, calendar, `Clock` (the dataset loader takes it) |
| `JourneyTopisArrivalsService implements DepartureSource` | `journey/topis-arrivals/` | `journey_topis_arrivals` | repository, `Clock` |
| `JourneyDeparturesService` (the registry) | `journey/departures/` | the three doors | three |

```ts
// journey/departures/journey-departures.service.ts
@Injectable()
export class JourneyDeparturesService {
  private readonly sourceById: Readonly<Record<JourneySourceId, DepartureSource>>;

  constructor(bus: BusDeparturesService, subway: SubwayTimetableDeparturesService, topis: JourneyTopisArrivalsService) {
    this.sourceById = { jongro: bus, hssc: bus, shuttle: bus, subway, topisArrivals: topis };
  }

  listDepartures(source: JourneySourceId, query: DepartureQuery): Promise<DepartureBoard> {
    return this.sourceById[source].listDepartures(query);
  }
}
```

- `JOURNEY_SOURCE_IDS` is one `as const` list in `journey/journey.constants.ts`; `JourneySourceId`, the dataset schema's enum and the `Record` above derive from it, so a source added to the list fails `tsc` until the registry wires it.
- Every import is allowed by the boundaries: journey imports `BusDeparturesService` and `SubwayTimetableDeparturesService` (another feature's `.service`), `bus/departures` imports sibling services (`sub-modules`), `subway/timetable/departures` imports its parent's schema and rules, and `shared/departure.types.ts` is imported by all three features.
- No abstract class token: each door is injected as its concrete class (ADR 0010, D1), and `implements DepartureSource` is a compile-time check.
- If `bus/departures` outgrows the rules cap when HSSC lands, the seam is per source: sibling sub-modules per source with the door as their dispatcher (ADR 0010, D9).

## The route model as data

### Dataset `journey-routes`

One dataset document, read whole and small (ADR 0013, D1), validated at push and parsed at read (D5, D6). It holds the places, the lines and the routes, so "the spec" the owner edits is one file.

```ts
// journey/journey.document.ts (stored shape; zod in journey.schema.ts)
type LocalizedName = Readonly<Record<SupportedLang, string>>;  // ko, en, zh

interface JourneyRoutesData {
  catchMarginSeconds: number;                 // reach a boarding stop this long before the vehicle
  places: JourneyPlace[];
  lines: JourneyLine[];
  routes: JourneyRoute[];
}

interface JourneyPlace {
  id: string;                                 // REGISTRY_ID_RE
  name: LocalizedName;
  campus: Campus | null;                      // src/shared/campus.wire.ts
  coords: LatLng | null;
}

type JourneyLine = {
  id: string;
  mode: "bus" | "shuttle" | "subway";
  name: LocalizedName;
  color: string;                              // hex without #, as the app takes it
  action: { type: LinkActionType; value: string } | null;   // the app screen the line opens
} & (
  | { source: "jongro" | "hssc" | "shuttle" | "subway"; sourceLineId: string }
  | {
      source: "topisArrivals";
      sourceLineId: string;                   // TOPIS busRouteId
      serviceHours: { from: string; until: string };        // "HH:mm" KST; until may pass midnight
      stops: Array<{ stationId: string; staOrder: number }>; // the stops legs name, in line order
    }
);

interface JourneyRoute {
  id: string;
  campus: Campus;                             // the campus sheet that lists it
  name: LocalizedName;
  from: string;                               // place id
  to: string;                                 // place id
  options: JourneyOption[];                   // in the order a tie keeps
}

interface JourneyOption {
  id: string;
  mode: "shuttle" | "bus" | "subway";         // the option's icon, as the app's RouteMode
  name: LocalizedName;
  legs: JourneyLeg[];
}

type JourneyLeg =
  | { kind: "walk"; to: string; minutes: number; evidence: string }
  | { kind: "transfer"; at: string; minutes: number; evidence: string }
  | {
      kind: "ride";
      line: string;                           // line id
      from: { place: string; stopId: string };
      to: { place: string; stopId: string };
      rideMinutes: number;                    // used only when the source cannot place the run at `to`
      evidence: string;                       // where rideMinutes comes from
    };
```

- **Walk, transfer and fallback ride minutes always carry `evidence`**, a non-empty sentence: a measurement with its date, a routing service and its date, or `placeholder: …` while a value is a guess. The push refuses an empty one. A placeholder is visible in review and in `npm run data -- pull`.
- **A stop id is the source's own**, named directly in the leg, so one place can host several sources and platforms (금정 has a line 1 and a line 4 platform).
- **Line display is the dataset's.** A journey label can differ from the transit tab's (the shuttle service is "인사캠 → 자과캠" there, "인자셔틀" here). Jongno colors repeat `jongro-route-attributes`; accepted, and a push may cross-check them later.
- **Why ids and a TOPIS route id fit ADR 0013, D2:** the planner and the 7800 poller branch on none of them. The poller treats every `topisArrivals` line alike, so its route ids are data the code iterates, not identities it branches on.

The push checks (`toJourneyRoutesIssues` in `journey/journey.rules.ts`, declared in `scripts/lib/datasets/catalog.js`, refusing on any issue):

| Check | Against |
| --- | --- |
| Unique ids per kind; every leg's place and line resolves; each option starts at its route's `from` (its first leg reaches it or departs there) and ends at `to` | the dataset |
| A ride leg's stop ids belong to its line's source, and `from` precedes `to` on the line | Jongno: `JONGRO_ROUTES` and the target environment's stored `jongro_routes` registry; shuttle: `SERVICE_CONFIG` and the service's `bus-stops` sequence (`from` a `board`, `to` an `alight` stop); subway: a train of every day type of the stored `subway-ride-timetables` calls at both in order; HSSC: the `bus-stops` HSSC line; `topisArrivals`: the line's own `stops` by `staOrder` |
| Minutes are positive integers below a sanity bound; `catchMarginSeconds` from 0 to 300 | the dataset |
| The `topisArrivals` lines fit their quota: the sum over lines of `serviceHours` seconds ÷ `TOPIS_ARRIVALS_POLL_INTERVAL_MS` is at most `TOPIS_ARRIVALS_DAILY_CAP` | `journey/journey.constants.ts` |

The catalog gathers the identity sets from `dist/` (bus constants, the stored datasets and registry) and passes them to the pure rule, so `journey/` imports no other feature's constants.

### Worked example

The PoC's dataset, both routes and all eight options. Minutes are the app mock's placeholders except where a source gives better; the walk from either 7800 stop to 자과캠 정문 is lengthened from the mock's 5 to 10 because both stops are about 750 m from the main gate (the 2026-10-17 survey). Stop ids marked **Unverified** need checking in the PR that pushes them.

```jsonc
{
  "catchMarginSeconds": 60,
  "places": [
    { "id": "hssc-main-gate", "name": { "ko": "인사캠 정문", "en": "HSSC Main Gate", "zh": "人文社科校区正门" }, "campus": "hssc", "coords": null },
    { "id": "nsc-main-gate", "name": { "ko": "자과캠 정문", "en": "NSC Main Gate", "zh": "自然科学校区正门" }, "campus": "nsc", "coords": null },
    { "id": "hssc-bus-lot", "name": { "ko": "학생회관 버스 주차장", "en": "Student Center Bus Lot", "zh": "学生会馆巴士停车场" }, "campus": "hssc", "coords": null },
    { "id": "hssc-600th", "name": { "ko": "600주년기념관 앞", "en": "600th Anniversary Hall", "zh": "600周年纪念馆前" }, "campus": "hssc", "coords": null },
    { "id": "nsc-n-center", "name": { "ko": "N센터 앞", "en": "N Center", "zh": "N中心前" }, "campus": "nsc", "coords": null },
    { "id": "nsc-opposite", "name": { "ko": "N센터 맞은편", "en": "Across from N Center", "zh": "N中心对面" }, "campus": "nsc", "coords": null },
    { "id": "hyehwa", "name": { "ko": "혜화역", "en": "Hyehwa Stn.", "zh": "惠化站" }, "campus": "hssc", "coords": null },
    { "id": "sadang", "name": { "ko": "사당역", "en": "Sadang Stn.", "zh": "舍堂站" }, "campus": null, "coords": null },
    { "id": "sadang-exit9", "name": { "ko": "사당역 9번 출구", "en": "Sadang Stn. Exit 9", "zh": "舍堂站9号出口" }, "campus": null, "coords": null },
    { "id": "sadang-median", "name": { "ko": "사당역(중)", "en": "Sadang Stn. (Median)", "zh": "舍堂站(中央)" }, "campus": null, "coords": null },
    { "id": "geumjeong", "name": { "ko": "금정역", "en": "Geumjeong Stn.", "zh": "衿井站" }, "campus": null, "coords": null },
    { "id": "skku-station", "name": { "ko": "성균관대역", "en": "Sungkyunkwan Univ. Stn.", "zh": "成均馆大学站" }, "campus": "nsc", "coords": null },
    { "id": "nsc-7800-seoul", "name": { "ko": "성균관대학교 (서울 방면)", "en": "Sungkyunkwan Univ. (to Seoul)", "zh": "成均馆大学 (首尔方向)" }, "campus": "nsc", "coords": null },
    { "id": "nsc-7800-suwon", "name": { "ko": "성균관대학교 (수원 방면)", "en": "Sungkyunkwan Univ. (to Suwon)", "zh": "成均馆大学 (水原方向)" }, "campus": "nsc", "coords": null },
    { "id": "myeongnyun-market", "name": { "ko": "명륜시장.성대후문", "en": "Myeongnyun Market", "zh": "明伦市场" }, "campus": "hssc", "coords": null },
    { "id": "jongno5ga-gwangjang", "name": { "ko": "종로5가역.광장시장", "en": "Jongno 5-ga Stn. (Gwangjang Market)", "zh": "钟路5街站.广藏市场" }, "campus": null, "coords": null },
    { "id": "jongno5ga-jungbu", "name": { "ko": "종로5가역.중부교육지원청", "en": "Jongno 5-ga Stn. (Jungbu)", "zh": "钟路5街站.中部教育支援厅" }, "campus": null, "coords": null },
    { "id": "jongno5ga", "name": { "ko": "종로5가역", "en": "Jongno 5-ga Stn.", "zh": "钟路5街站" }, "campus": null, "coords": null }
  ],
  "lines": [
    { "id": "inja", "mode": "shuttle", "source": "shuttle", "sourceLineId": "campus-inja/regular", "name": { "ko": "인자셔틀", "en": "INJA Shuttle", "zh": "校区间班车" }, "color": "003626", "action": { "type": "route", "value": "/bus/schedule?groupId=campus" } },
    { "id": "jain", "mode": "shuttle", "source": "shuttle", "sourceLineId": "campus-jain/regular", "name": { "ko": "인자셔틀", "en": "INJA Shuttle", "zh": "校区间班车" }, "color": "003626", "action": { "type": "route", "value": "/bus/schedule?groupId=campus" } },
    { "id": "line4", "mode": "subway", "source": "subway", "sourceLineId": "4", "name": { "ko": "4호선", "en": "Line 4", "zh": "4号线" }, "color": "00A5DE", "action": null },
    { "id": "line1", "mode": "subway", "source": "subway", "sourceLineId": "1", "name": { "ko": "1호선", "en": "Line 1", "zh": "1号线" }, "color": "0052A4", "action": null },  // Unverified: line 1 color against the app's subwayLineColor
    { "id": "jongro08", "mode": "bus", "source": "jongro", "sourceLineId": "jongro08", "name": { "ko": "종로08", "en": "Jongro 08", "zh": "钟路08" }, "color": "4CAF50", "action": { "type": "route", "value": "/bus/realtime?groupId=jongro08" } },
    {
      "id": "bus7800", "mode": "bus", "source": "topisArrivals", "sourceLineId": "200000150",
      "name": { "ko": "7800", "en": "7800", "zh": "7800" }, "color": "E60012", "action": null,
      "serviceHours": { "from": "05:00", "until": "01:00" },   // Unverified: first and last bus; adjust by push
      "stops": [
        { "stationId": "200000162", "staOrder": 24 },          // 성균관대학교, toward Seoul
        { "stationId": "121001315", "staOrder": 39 },          // 사당역(중), alight only
        { "stationId": "119000302", "staOrder": 41 },          // 사당역9번출구앞, board only
        { "stationId": "200000159", "staOrder": 58 }           // 성균관대학교, toward Suwon
      ]
    }
  ],
  "routes": [
    {
      "id": "hssc-to-nsc", "campus": "hssc", "from": "hssc-main-gate", "to": "nsc-main-gate",
      "name": { "ko": "인사캠 → 자과캠", "en": "HSSC → NSC", "zh": "人社校区 → 自科校区" },
      "options": [
        { "id": "inja", "mode": "shuttle", "name": { "ko": "인자셔틀", "en": "INJA Shuttle", "zh": "校区间班车" }, "legs": [
          { "kind": "walk", "to": "hssc-bus-lot", "minutes": 3, "evidence": "placeholder: app mock (students' guides 2026-03)" },
          { "kind": "ride", "line": "inja", "from": { "place": "hssc-bus-lot", "stopId": "hssc-bus-lot" }, "to": { "place": "nsc-n-center", "stopId": "nsc-n-center" }, "rideMinutes": 65, "evidence": "placeholder: app mock; the shuttle ETA replaces it per run" },
          { "kind": "walk", "to": "nsc-main-gate", "minutes": 3, "evidence": "placeholder: app mock" }
        ] },
        { "id": "line4-line1", "mode": "subway", "name": { "ko": "4호선 · 1호선", "en": "Line 4 · Line 1", "zh": "4号线 · 1号线" }, "legs": [
          { "kind": "walk", "to": "hyehwa", "minutes": 15, "evidence": "placeholder: app mock" },
          { "kind": "ride", "line": "line4", "from": { "place": "hyehwa", "stopId": "S1-4-420" }, "to": { "place": "geumjeong", "stopId": "KR-4-443" }, "rideMinutes": 45, "evidence": "placeholder: app mock" },  // Unverified: line 4 금정 platform id
          { "kind": "transfer", "at": "geumjeong", "minutes": 5, "evidence": "placeholder: app mock" },
          { "kind": "ride", "line": "line1", "from": { "place": "geumjeong", "stopId": "KR-1-P149" }, "to": { "place": "skku-station", "stopId": "KR-1-0153" }, "rideMinutes": 12, "evidence": "placeholder: app mock" },
          { "kind": "walk", "to": "nsc-main-gate", "minutes": 12, "evidence": "placeholder: app mock" }
        ] },
        { "id": "jongro08-line1", "mode": "subway", "name": { "ko": "종로08 · 1호선", "en": "Jongro 08 · Line 1", "zh": "钟路08 · 1号线" }, "legs": [
          { "kind": "walk", "to": "myeongnyun-market", "minutes": 3, "evidence": "placeholder: app mock" },
          { "kind": "ride", "line": "jongro08", "from": { "place": "myeongnyun-market", "stopId": "seoul-01531" }, "to": { "place": "jongno5ga-gwangjang", "stopId": "seoul-01794" }, "rideMinutes": 12, "evidence": "placeholder: app mock" },
          { "kind": "transfer", "at": "jongno5ga", "minutes": 3, "evidence": "placeholder: app mock" },
          { "kind": "ride", "line": "line1", "from": { "place": "jongno5ga", "stopId": "S1-1-154" }, "to": { "place": "skku-station", "stopId": "KR-1-0153" }, "rideMinutes": 73, "evidence": "placeholder: app mock" },  // Unverified: 종로5가 platform id
          { "kind": "walk", "to": "nsc-main-gate", "minutes": 12, "evidence": "placeholder: app mock" }
        ] },
        { "id": "line4-7800", "mode": "subway", "name": { "ko": "4호선 · 7800", "en": "Line 4 · 7800", "zh": "4号线 · 7800" }, "legs": [
          { "kind": "walk", "to": "hyehwa", "minutes": 15, "evidence": "placeholder: app mock" },
          { "kind": "ride", "line": "line4", "from": { "place": "hyehwa", "stopId": "S1-4-420" }, "to": { "place": "sadang", "stopId": "S1-4-433" }, "rideMinutes": 25, "evidence": "placeholder: app mock" },  // Unverified: 사당 platform id
          { "kind": "transfer", "at": "sadang-exit9", "minutes": 5, "evidence": "placeholder: app mock" },
          { "kind": "ride", "line": "bus7800", "from": { "place": "sadang-exit9", "stopId": "119000302" }, "to": { "place": "nsc-7800-suwon", "stopId": "200000159" }, "rideMinutes": 30, "evidence": "placeholder: app mock; live segment times replace it" },
          { "kind": "walk", "to": "nsc-main-gate", "minutes": 10, "evidence": "estimate: about 750 m from the stop to the main gate (2026-10-17 survey)" }
        ] }
      ]
    },
    {
      "id": "nsc-to-hssc", "campus": "nsc", "from": "nsc-main-gate", "to": "hssc-main-gate",
      "name": { "ko": "자과캠 → 인사캠", "en": "NSC → HSSC", "zh": "自科校区 → 人社校区" },
      "options": [
        { "id": "inja", "mode": "shuttle", "name": { "ko": "인자셔틀", "en": "INJA Shuttle", "zh": "校区间班车" }, "legs": [
          { "kind": "walk", "to": "nsc-opposite", "minutes": 3, "evidence": "placeholder: app mock" },
          { "kind": "ride", "line": "jain", "from": { "place": "nsc-opposite", "stopId": "nsc-opposite" }, "to": { "place": "hssc-600th", "stopId": "hssc-600th" }, "rideMinutes": 65, "evidence": "placeholder: app mock; the shuttle ETA replaces it per run" },
          { "kind": "walk", "to": "hssc-main-gate", "minutes": 1, "evidence": "placeholder: app mock" }
        ] },
        { "id": "line1-line4", "mode": "subway", "name": { "ko": "1호선 · 4호선", "en": "Line 1 · Line 4", "zh": "1号线 · 4号线" }, "legs": [
          { "kind": "walk", "to": "skku-station", "minutes": 12, "evidence": "placeholder: app mock" },
          { "kind": "ride", "line": "line1", "from": { "place": "skku-station", "stopId": "KR-1-0153" }, "to": { "place": "geumjeong", "stopId": "KR-1-P149" }, "rideMinutes": 12, "evidence": "placeholder: app mock" },
          { "kind": "transfer", "at": "geumjeong", "minutes": 5, "evidence": "placeholder: app mock" },
          { "kind": "ride", "line": "line4", "from": { "place": "geumjeong", "stopId": "KR-4-443" }, "to": { "place": "hyehwa", "stopId": "S1-4-420" }, "rideMinutes": 45, "evidence": "placeholder: app mock" },
          { "kind": "walk", "to": "hssc-main-gate", "minutes": 15, "evidence": "placeholder: app mock" }
        ] },
        { "id": "line1-jongro08", "mode": "subway", "name": { "ko": "1호선 · 종로08", "en": "Line 1 · Jongro 08", "zh": "1号线 · 钟路08" }, "legs": [
          { "kind": "walk", "to": "skku-station", "minutes": 12, "evidence": "placeholder: app mock" },
          { "kind": "ride", "line": "line1", "from": { "place": "skku-station", "stopId": "KR-1-0153" }, "to": { "place": "jongno5ga", "stopId": "S1-1-154" }, "rideMinutes": 73, "evidence": "placeholder: app mock" },
          { "kind": "transfer", "at": "jongno5ga-jungbu", "minutes": 3, "evidence": "placeholder: app mock" },
          { "kind": "ride", "line": "jongro08", "from": { "place": "jongno5ga-jungbu", "stopId": "seoul-01725" }, "to": { "place": "myeongnyun-market", "stopId": "seoul-01864" }, "rideMinutes": 12, "evidence": "placeholder: app mock" },
          { "kind": "walk", "to": "hssc-main-gate", "minutes": 3, "evidence": "placeholder: app mock" }
        ] },
        { "id": "7800-line4", "mode": "bus", "name": { "ko": "7800 · 4호선", "en": "7800 · Line 4", "zh": "7800 · 4号线" }, "legs": [
          { "kind": "walk", "to": "nsc-7800-seoul", "minutes": 10, "evidence": "estimate: about 750 m from the main gate to the stop (2026-10-17 survey)" },
          { "kind": "ride", "line": "bus7800", "from": { "place": "nsc-7800-seoul", "stopId": "200000162" }, "to": { "place": "sadang-median", "stopId": "121001315" }, "rideMinutes": 30, "evidence": "placeholder: app mock; live segment times replace it" },
          { "kind": "transfer", "at": "sadang", "minutes": 5, "evidence": "placeholder: app mock" },
          { "kind": "ride", "line": "line4", "from": { "place": "sadang", "stopId": "S1-4-433" }, "to": { "place": "hyehwa", "stopId": "S1-4-420" }, "rideMinutes": 25, "evidence": "placeholder: app mock" },
          { "kind": "walk", "to": "hssc-main-gate", "minutes": 15, "evidence": "placeholder: app mock" }
        ] }
      ]
    }
  ]
}
```

The 종로08 stop ids come from the stored registry as captured on 2026-10-17 (`__tests__/nest/bus/fixtures/jongro-registry-routes.json`): outbound 명륜시장.성대후문 `01531` (seq 4) to 종로5가역.광장시장 `01794` (seq 17), back from 종로5가역.중부교육지원청 `01725` (seq 18) to 명륜시장.성대후문 `01864` (seq 29). The shuttle stop ids are the `bus-stops` sequences of `campus-inja` and `campus-jain` (production capture). The 7800 ids are the 2026-10-17 survey's. The NSC-to-HSSC 7800 option ends with a walk from 혜화역 for symmetry; the mock's 종로07 last leg is the first example of adding a route below.

### Adding a route later

**A route or option over sources the server already reads** (another campus pair, the 종로07 last leg, a 혜화역 → 인사캠 route): data only.

1. `npm run data -- pull journey-routes`.
2. Add the places, any new line of an existing source (a `jongro07` entry with `source: "jongro"`), and the route or option with its legs, each minute with its evidence.
3. If a subway leg boards or alights at a platform the ride timetables do not cover, regenerate them: `convert.py --ride` reads the subway stop ids from the pulled `journey-routes` working file (see below), so a Seoul Metro station needs nothing else; a Korail station needs its xlsx short name in the script's KRIC table first. Push `subway-ride-timetables` before `journey-routes`, since the routes push checks the pair against the stored tables.
4. `npm run data -- push journey-routes` (to `_dev`), check `GET /journey/routes`, then `push --prod`. Every replica serves it within a minute (ADR 0013, D6).

**A new line on the TOPIS arrivals source** (another 광역버스 TOPIS answers by GBIS route id): data only. Add a `topisArrivals` line with its `serviceHours` and the `stops` its legs use. The push refuses it when the lines together would exceed `TOPIS_ARRIVALS_DAILY_CAP`; see [7800](#7800).

**A new source** (an upstream the server does not read yet, such as GBIS for seats): one adapter.

1. The poller, client and repository the upstream needs (ADR 0012, D1), with a runtime switch if it spends a shared quota (D5).
2. A door service that `implements DepartureSource`.
3. Its id in `JOURNEY_SOURCE_IDS`; `tsc` then fails until `JourneyDeparturesService` maps it, and the catalog's identity check for its stop ids is added beside the others.

Nothing in the planner, the routes flow or the wire changes.

## The planner

### The function

Pure, in `journey/routes/journey-routes.rules.ts`, over the dataset, one board per distinct leg query, and the time:

```ts
export type PlannedLeg =
  | { kind: "walk" | "transfer"; leg: WalkLeg | TransferLeg; startAt: Date; endAt: Date }
  | {
      kind: "ride";
      leg: RideLeg;
      line: JourneyLine;
      departure: Departure;          // the vehicle boarded, extrapolated when it came from a headway
      boardAt: Date;
      alightAt: Date;
      alightBasis: DepartureBasis;   // the departure's alight basis, or "estimate" from rideMinutes
      waitMs: number;                // boardAt minus when the rider is ready at the stop
      laterBoardAts: Date[];         // the next two catchable vehicles, for "다음 N분"
    };

export type PlannedOption =
  | { status: "running"; option: JourneyOption; leaveAt: Date; arriveAt: Date; legs: PlannedLeg[] }
  | { status: "notRunning"; option: JourneyOption; reason: "ended" | "unavailable" };

export function planOption(option: JourneyOption, boards: LegBoards, context: PlanContext): PlannedOption;
export function planRoute(route: JourneyRoute, boards: LegBoards, context: PlanContext): PlannedOption[];
```

```text
t = now; walked = 0; leaveAt = null
for leg in option.legs:
  walk | transfer: t += leg.minutes; if no ride yet: walked += leg.minutes
  ride:
    board = boards[leg]                  (DepartureUnavailableError → notRunning "unavailable")
    readyAt = t + catchMargin
    dep = first departure with boardAt(dep) >= readyAt and seatsLeft != 0
    none listed: continuation headway and readyAt before serviceEndsAt
                   → an estimated departure at readyAt + headway / 2, basis "estimate"
                 otherwise → notRunning "ended"
    alightAt = dep.alight?.arrivalAt ?? boardAt(dep) + leg.rideMinutes
    leaveAt ??= max(now, boardAt(dep) - walked - catchMargin)
    t = alightAt
arriveAt = t
planRoute: running options by arriveAt (stable: data order breaks a tie), then notRunning in data order
```

- Every ride leg is planned from the first vehicle the rider can catch after the previous leg, never from "the next one now".
- The buffers are data: walk and transfer minutes per leg, `catchMarginSeconds` per dataset.
- `waitMs` is the red "N분" of the mock-up; `leaveAt` is "N분 후 출발".
- Realtime reaches the first leg or two. A 7800 boarded at 사당 about 40 minutes out is past TOPIS's two buses, so it is extrapolated from the headway and carries `basis: estimate`; the app shows "약 N분".
- `seatsLeft: 0` skips a vehicle; with seats null in the PoC it never fires.

The routes service is the only caller: it reads the dataset, builds one `DepartureQuery` per distinct `(source, line, from stop, to stop)` over `[now, now + PLAN_HORIZON_MS]` (3 hours), awaits them together, catches each failure into the board map, and calls `planRoute` per route. Its constructor: the parent's `JourneyRepository`, `JourneyDeparturesService`, `Clock`.

### Wire: `GET /journey/routes`

`journey/routes/journey-routes.wire.ts`, published to `contracts/produced/` (ADR 0010, D13). The names follow the app's `PlannedOption` and `Leg`; what changes for the app is that times are instants, names arrive in the request language, and a ride leg carries its departure instead of a `Departures` schedule to plan from.

```ts
const instant = z.iso.datetime({ offset: true });           // from src/shared once PR 1 lands
const basis = z.enum(["provider", "estimate", "timetable"]); // open
const place = z.object({ id: z.string(), name: z.string() });

const walkLeg = z.object({ kind: z.literal("walk"), minutes: z.int(), to: place, startAt: instant, endAt: instant });
const transferLeg = z.object({ kind: z.literal("transfer"), minutes: z.int(), at: place, startAt: instant, endAt: instant });
const rideLeg = z.object({
  kind: z.enum(["bus", "subway"]),                           // as the mock; a shuttle is a bus leg
  line: z.object({ id: z.string(), name: z.string(), color: z.string(), actionType: linkActionType.nullable(), actionValue: z.string().nullable() }),
  from: place,
  to: place,
  departAt: instant,
  departBasis: basis,
  arriveAt: instant,
  arriveBasis: basis,
  waitMinutes: z.int(),
  rideMinutes: z.int(),
  headsign: z.string().nullable(),
  vehicleId: z.string().nullable(),
  seatsLeft: z.int().nullable(),
  crowding: z.enum(["relaxed", "normal", "crowded"]).nullable(),
  isLastRun: z.boolean().nullable(),
  laterDepartAts: z.array(instant),
});

const plannedOption = z.object({
  id: z.string(),
  mode: z.enum(["shuttle", "bus", "subway"]),                // open
  name: z.string(),
  status: z.enum(["running", "notRunning"]),                 // open
  reason: z.enum(["ended", "unavailable"]).nullable(),       // open; null while running
  leaveAt: instant.nullable(),
  arriveAt: instant.nullable(),
  legs: z.array(z.union([walkLeg, transferLeg, rideLeg])),   // a client drops a leg kind it does not know
});

export const journeyRoutes = z.object({
  routes: z.array(z.object({ id: z.string(), campus, name: z.string(), from: place, to: place, options: z.array(plannedOption) })),
});
export const journeyRoutesMeta = z.object({ serverNow: instant });
```

- **Query:** `campus` (`hssc` or `nsc`), optional; without it every route. An unknown campus is `400` through `ZodValidationPipe`.
- **Every key present, null when unknown**, and every enum open (ADR 0019, D2 and D3).
- **Cache:** `Cache-Control: private, max-age=15` and no ETag. The body is localized and changes with every poll and every minute, so a shared cache could serve one language to everyone, and an ETag would almost never match. `meta.serverNow` lets the app keep its clock offset (ADR 0019, D10).
- **Errors:** the dataset unavailable is `503` with no `Cache-Control` (ADR 0013, D6). A source that fails marks only its options `notRunning` / `unavailable`, logged once per throttle window.
- **Role:** api only reads. The dataset, `bus_cache`, `shuttle_eta` and the schedules, `subway_arrivals`, `subway-ride-timetables` and `journey_topis_arrivals` are all read from MongoDB through cached loaders; no upstream call (ADR 0012, D1). `__tests__/nest/infra/api-role-boot.test.ts` gains the module, so an api boot that fetches fails.
- **Prefix:** `JourneyModule` owns `/journey` and binds the limiter once (ADR 0010, D7).

### The journey module

```text
journey/
  journey.module.ts               /journey prefix, limiter, SEE: docs/explanation/journey-architecture.md
  journey.document.ts             JourneyRoutesData (dataset), TopisArrivalsDoc (journey_topis_arrivals)
  journey.schema.ts               journeyRoutesDataset: parsed at push and at read
  journey.rules.ts                toJourneyRoutesIssues, toTopisArrivalsDailyCalls
  journey.repository.ts           the dataset through createDatasetLoader (ADR 0013, D6)
  journey.constants.ts            JOURNEY_SOURCE_IDS, TOPIS_ARRIVALS_POLL_INTERVAL_MS, TOPIS_ARRIVALS_DAILY_CAP, PLAN_HORIZON_MS
  journey.types.ts                JourneySourceId, LegBoards, PlanContext
  routes/                         GET /journey/routes: controller, service, rules (the planner), mapper, wire, constants
  departures/                     JourneyDeparturesService, the registry
  topis-arrivals/                 the 7800 poller, client, repository, door service, rules, mapper, schema, types
```

`docs/explanation/journey-architecture.md` is written from `_module-template.md` with the first PR that adds the module; its glossary holds `departure`, `run`, `route`, `option`, `leg`, `place`, `line`, `catch margin`, with `corridor` and `itinerary` in Not.

## 7800

### Endpoint and stops

- **Endpoint:** TOPIS `arrive/getArrInfoByRouteAll?busRouteId=200000150` on `SEOUL_BUS_SERVICE_KEY`, one call per poll for the whole route, both directions. The 2026-10-17 survey found that TOPIS answers this Gyeonggi route by its GBIS route id, Gyeonggi stops included; the first PR captures a fixture before anything relies on it.
- **Why the whole-route call and not `getArrInfoByRoute` per stop:** one call covers both boarding stops, and every stop's first two buses give the segment times between the stops that the alighting estimate sums. The per-stop call would use an untouched pool but would leave the ride time to the leg's placeholder.
- **Stops:** the line's `stops` in the dataset, today 성균관대학교 `200000162` (staOrder 24, toward Seoul) and `200000159` (58, toward Suwon), 사당역(중) `121001315` (39, alight only), 사당역9번출구앞 `119000302` (41, board only). The poller stores every stop TOPIS answers; the adapter answers only for listed stops.
- **Seats:** GBIS `busarrivalservice/v2` `remainSeatCnt1/2` would fill `seatsLeft`. It needs the data.go.kr dataset `15080346` approved (status unknown) and, under ADR 0012, its own poller, not a request-time call. Out of the PoC.

### Cadence and the TOPIS budget

TOPIS meters each operation per key per day, 20,000 each ([project-docs.md](../project-docs.md), "Daily Usage and Quota Check").

| `getArrInfoByRouteAllList` | Calls a day |
| --- | --- |
| Jongno 02, 07, 08, all day at 25 s: 3 × 86,400 / 25 (`JONGRO_POLL_INTERVAL_MS`, `src/bus/bus.constants.ts`) | 10,368 |
| Left | 9,632 |
| 7800 at 30 s over a 20-hour window (05:00 to 01:00): 72,000 / 30 | 2,400 |
| Left after 7800 | 7,232 |

- `TOPIS_ARRIVALS_POLL_INTERVAL_MS = 30_000`: TOPIS's data advances about every 20 s (the 2026-10-17 capture), and a rider's plan does not need Jongno's 25 s.
- `TOPIS_ARRIVALS_DAILY_CAP = 2_600`, a `DailyCap("topis-arrivals", …)` in the poller process (`src/shared/daily-cap.util.ts`), separate from the probe's `topisDailyCap` (`src/infra/config.ts:178`), which meters another operation. The push check keeps the lines' planned calls under it, so a second line at the same window and cadence is refused until the cap, the window or the operation changes.
- (A credential detail is left out of the public history.)
- The window is data: polling stops outside `serviceHours`, and a missing first or last bus is fixed by a push.

### Poller, document and adapter

```ts
// journey/journey.document.ts; one document per line, replaced each poll
interface TopisArrivalsDoc {
  _id: string;                  // the journey line id, "bus7800"
  routeId: string;              // TOPIS busRouteId
  observedAt: Date;             // the newest mkTm in the answer
  checkedAt: Date;              // when the poller fetched it
  headwayMinutes: number | null;  // TOPIS term (Unverified for a Gyeonggi route)
  stops: Array<{
    stationId: string;
    staOrder: number;
    buses: Array<{ vehicleId: string; plateNumber: string | null; expectedAt: Date | null; stopsAway: number | null; isLastBus: boolean | null; providerText: string | null }>;
  }>;
}
```

- **`JourneyTopisArrivalsPoller`** ticks every 30 s where pollers run, reads the `topisArrivals` lines from the parent's `JourneyRepository`, and for each line inside its `serviceHours` takes the daily cap, fetches, maps and replaces the line's document. A failure rejects (the poller registry reports it); it is never caught and logged in the poller.
- **`JourneyTopisArrivalsClient`** parses the rows and turns `mkTm + traTime` into instants, as Jongno's client does; a raw TOPIS row never leaves it (ADR 0010, D1).
- **`journey_topis_arrivals`** in `config.journey.collections`; keyed by `_id`, so it needs no index. One document of about 60 stops is a few kilobytes.
- **`JourneyTopisArrivalsService`**, the door, reads the line's document through a cached loader (5 s TTL, `HOT_READ_MAX_TIME_MS`) and maps it: a document older than 90 s (`MAX_ARRIVALS_AGE_MS`) contributes no listed buses; its headway still continues for up to 24 hours, as `basis: estimate`; with no document or no headway the door throws `DepartureUnavailableError`. The alighting time is the same `vehicleId` at the alighting stop, else the sum of the segment times between the two stops, each segment from a vehicle listed at both of its ends in the same answer, else null.

## Subway coverage

### What is missing

| Leg | Platforms | In today's `subway-timetables`? |
| --- | --- | --- |
| 4호선 혜화 ↔ 사당 | `S1-4-420`, `S1-4-433` (**Unverified** id) | No: line 4 is `414`..`426` |
| 4호선 혜화 ↔ 금정 | `S1-4-420`, the line 4 금정 platform (**Unverified** id; a Korail-operated station south of 남태령) | No |
| 1호선 금정 ↔ 성균관대 | `KR-1-P149`, `KR-1-0153` | Yes: line 1 covers 병점..안양 |
| 1호선 종로5가 ↔ 성균관대 | `S1-1-154` (**Unverified** id), `KR-1-0153` | No: 종로5가 is north of 안양 |

### A separate dataset, not a wider tracker table

The tracker's tables stay as they are. The awaited-train estimate counts a train's run from its first stop in the file (`src/subway/estimate/subway-estimate.rules.ts:123`), and the service-window and coverage refusals run over every listed station, so widening a tracker table would shift live arrivals by tens of minutes. The planner reads its own tables instead:

- **`subway-ride-timetables`**, one dataset, not parted: `{ tables: Timetable[] }`, the same `Timetable` shape the tracker parses (`src/subway/timetable/subway-timetable.types.ts`), keyed by `operator-line-dayType` as `toTimetableKey` does. Each table lists only the platforms a `journey-routes` subway leg names, so it stays small (a few thousand stop times for both lines and every day type).
- **Produced by `scripts/subway-timetable/convert.py --ride <pulled journey-routes file>`** into a pulled `subway-ride-timetables` directory (ADR 0013, D3): it collects every subway leg's platform ids, keeps a train when it calls at two of them in order, and writes the same JSON shape. Seoul Metro stations (`S1-…`) come from `SearchSTNTimeTableByIDService` by the station code the id ends in; Korail stations come from the Korail xlsx by their short name in the script's KRIC table, which needs one row per new Korail station.
- **Read by `SubwayTimetableDeparturesService`**, a child of `src/subway/timetable/`, with the parent's schema and `toScheduledTrains`, through `createDatasetLoader`.
- **Push checks:** the schema, a table per day type its source declares, and times increasing along each train.

### Probes before the data

- **사당:** Seoul Metro, so `SearchSTNTimeTableByIDService` should answer it as it answers 혜화. Confirm its id and station code.
- **4호선 금정:** whether the Seoul API answers Korail-operated line 4 stations was already open on 2026-10-20. If it does not, the Korail xlsx for the 과천·안산선 section is the next source (**Unverified** that it exists in the same format). With neither, the leg still plans: the timetable at 혜화 gives the boarding train and `rideMinutes` the arrival, as `basis: estimate`.
- **종로5가 on line 1:** whether the Korail xlsx lists the Seoul Metro underground section's stations beyond the two termini its abbreviations name (`KORAIL_ABBREVIATIONS`), or whether 종로5가 comes from the Seoul API and joins the Korail trains by train number (**Unverified** that both number a through train alike).

## F1: one departure model for the stop page and the live route

- **The PoC does not extend F1.** `BusDeparturesService` maps from domain reads (`findJongroReading`, and a new domain read of the smart view's runs), never from `LiveGroup` or `SmartSchedule`. The smart view's run read is split out of `BusEtaSmartService`, so `resolveSmart` becomes "runs, then localize" and the door reads the first half; `/bus/schedule` and the stop page are pinned by characterization tests before the split (ADR 0010, D12).
- **The fix is a follow-up, in two PRs:**
  1. The stop page's timetable entries come from `BusDeparturesService.listDepartures` with `alightStopId: null`, mapped to `arrival` by one mapper at the bus root. `SmartSchedule` stops being an input; the rules that parse `"HH:mm"` back into instants go.
  2. Its live entries, and the live route's per-station arrivals, come from the same `Departure`s through the same mapper, with the vehicles from the same reading; the HSSC domain read is added for this. `LiveGroup` stops being an input.
- After both, `/bus/live`, the stop page and `/journey/routes` describe one vehicle at one stop from one `Departure`, so the three cannot disagree. Neither PR changes a response: the characterization tests stay as they are.

## PR sequence

Each PR merges to `dev`, deploys, and is verified live before the next (pstack shipping).

| PR | Change | What it proves |
| --- | --- | --- |
| 1 | Declare `instant` and `latLng` once in `src/shared/` (`.wire`) and import them in the bus, ui and stop-list wires | `contracts/produced/` is byte-identical: nothing served changes |
| 2 | `shared/departure.types.ts` and `departure.error.ts`; the smart view's run read split out under characterization; `bus/departures/` with the shuttle mapping; a new ADR recording this spec | A spec drives the same stored state through the stop page and the door and gets the same instants for every 인자셔틀 run |
| 3 | `journey/`: the `journey-routes` dataset (schema, push checks, catalog entry), the planner, the registry with the bus door, `GET /journey/routes`, the module doc; push a dataset with the two 인자셔틀 options only | The route serves live in production, its 인자셔틀 times match `/bus/schedule/data/campus-inja/smart`; the push refuses an unknown stop id, an empty evidence and a reversed stop pair |
| 4 | `subway-ride-timetables`: `convert.py --ride`, the dataset, `SubwayTimetableDeparturesService` and its registry entry; push tables for 금정 ↔ 성균관대 (line 1, already in the source files) and 혜화 ↔ 사당; push the line 4 and line 1 legs the tables cover | The tracker's arrivals are unchanged (its tables are untouched); a planned subway leg's times equal the timetable's for the same train |
| 5 | Jongno in `BusDeparturesService` (with `term` stored by the Jongno poller if TOPIS sends it); push the 종로08 → 1호선 options once 종로5가 is covered | The 종로08 leg's first vehicle matches `/bus/live/jongro08` for the same stop |
| 6 | 7800: client with a captured fixture, `JourneyTopisArrivalsPoller`, `journey_topis_arrivals`, the door, the `JOURNEY_TOPIS` switch; push the 7800 line and both 7800 options | The poll stays under its cap (logged daily count), and the 사당 boarding vehicle matches TOPIS's answer for that stop |
| 7 | Subway realtime at the served platforms (혜화, 성균관대) in the subway door | A first subway leg's departure equals `/subway/stations/hyehwa/arrivals` for the same train |
| 8 | F1, step 1: stop page timetable entries from `BusDeparturesService` | The stop page characterization test passes unchanged |
| 9 | F1, step 2: live entries and `/bus/live` from `Departure`s; HSSC domain read | Both characterization tests pass unchanged |

The 4호선 금정 leg waits for its probe; until then its options are not in the dataset, which is a data decision, not a code one.

## Shapes considered

Three whole shapes were sketched before this one was chosen.

| Shape | What it does | Why it lost |
| --- | --- | --- |
| A. Consumer-owned adapters | `journey/` holds every adapter and reads bus and subway through new door methods | The stop page cannot read journey without bus depending on journey and journey on bus, so F1 could never close; every adapter would need the source's internals as `import type` |
| B. One stored departures collection | Every poller, and a materializer for timetables, writes `Departure`s into one collection the planner reads | Copies every timetable into a second store each day, writes Jongno twice, and adds Atlas writes for data already stored; the shuttle ETA and subway delay logic would run twice |
| C. Producer-owned doors over a shared type (chosen) | The type in `src/shared/`, each data owner's door maps its own runs, the journey registry picks a door | Takes A's single registry and B's single shape; the stop page can read the bus door inside bus, so F1 closes |

Arena runners were not dispatched for this sketch; the comparison above was made in one pass.

Tradeoffs accepted:

- Jongno colors are stated in both `jongro-route-attributes` and `journey-routes`, in exchange for one file holding everything a route shows.
- A subway timetable is stored twice for the stations the planner uses, in exchange for leaving the tracker's estimates untouched.
- 7800 lives in `journey/`, not `src/bus/`, because bus's doc and wire are at their caps and nothing else reads it yet. If the transit tab shows 7800 later, it reads `JourneyTopisArrivalsService`.
- The PoC's minutes are placeholders with that word in their evidence, in exchange for shipping the shape before the walk-throughs.

## Open questions for the owner

| Question | Recommendation |
| --- | --- |
| The route URL: `GET /journey/routes?campus=` or the mock's `/map/routes` | `/journey/routes`. The map module owns `/map` and its limiter; journey is its own feature and the app changes one string |
| Names on the wire: the request language (the server's convention) or all languages per field (the mock's `RouteText`) | The request language, with `meta.lang`, like every other localized route |
| Where an option ends: 정문 for both campuses, as the mock does | 정문. The 7800 options then walk about 10 minutes from the stop, not the mock's 5 |
| 학부대학 runs of the 인자셔틀: offer them to everyone | No: `campus-inja/regular` only, until it is confirmed who may board them |
| NSC → HSSC via 7800: end with a walk from 혜화 or with 종로07 as the mock does | Walk first; add 종로07 by a data push once PR 5 lands |
| 7800 cadence: 30 s, leaving 7,232 calls a day | 30 s |
| Stale realtime: show an estimate from the headway or hide the option | Show it, as `basis: estimate` ("약 N분"), for up to 24 hours after the last good poll; hide it after that |
| GBIS seat counts: is the data.go.kr application `15080346` approved | Check it; seats need their own poller and quota either way, so they stay out of the PoC |
| `basis` vocabulary: ADR 0019's `provider` instead of `realtime` | Keep ADR 0019's, so every wire uses one vocabulary |

## Related

- [ADR 0010](../decisions/0010-server-architecture.md), [ADR 0012](../decisions/0012-runtime-roles.md), [ADR 0013](../decisions/0013-runtime-data-in-mongodb.md), [ADR 0018](../decisions/0018-hssc-arrival-estimates.md), [ADR 0019](../decisions/0019-bus-live-api.md)
- [docs/explanation/subway-architecture.md](../explanation/subway-architecture.md): what adding a station touches
- [docs/explanation/bus-architecture.md](../explanation/bus-architecture.md): the pollers and estimates
- [docs/how-to/edit-runtime-data.md](../how-to/edit-runtime-data.md): pull, push and roll back a dataset
