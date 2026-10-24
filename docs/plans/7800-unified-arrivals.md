---
title: 7800 and One Arrival Shape for Every Bus
type: plan
status: draft
owner: zoyoong124@gmail.com
last-updated: 2026-10-24
audience: internal
---

# 7800 and One Arrival Shape for Every Bus

> How the 7800 광역버스 joins the Jongno lines on `/bus/live` and the stop page in the ADR 0019 `arrival` shape, which upstream feeds it within which quota, and how the timetabled shuttles then produce the same shape from instants instead of the smart view's `"HH:mm"` strings, so the 길찾기 planner reads realtime and timetable buses through one model. Nothing here is built. It revises the 7800 and F1 sections of [transit-route-planner.md](transit-route-planner.md); the planner itself is out of scope.

## 1. Goal and scope

Owner, 2026-10-24:

1. 7800 (GBIS route `200000150`, 호매실동차고지 ↔ 사당역, via 성균관대학교) is served in the same `arrival` shape the HSSC shuttle and the Jongno lines already share (`src/bus/bus.wire.ts:57`), the way `/bus/live` and the stop page serve them.
2. Apply for the public APIs 7800 needs (owner-authorized): done 2026-10-24, §3.4.
3. Once 1 holds, the timetabled buses (인자셔틀 through the smart view, 학부대학 and 통학 runs) produce the same shape, so the planner consumes realtime and timetable buses through one model, and the stop page stops re-parsing `"HH:mm"` (review finding F1).

Out of scope: subway, the journey planner, app work, taxi.

**The reconciliation in one line.** The existing wire `arrival` is the common shape. The planner plan's `Departure` survives only as a join of two calls of one run, and its call type becomes the domain twin of `arrival`, field for field, with `Date` instants (§7). 7800 does not get its own `journey/` poller and collection: TOPIS answers it exactly as it answers a Jongno route, so it joins the Jongno pipeline as a fourth TOPIS route (§3, §4).

## 2. Facts

### Verified 2026-10-24 (Saturday, 17:20–17:26 KST)

The raw answers were not kept; PR 2 captures the fixtures again.

**TOPIS, 5 calls** (busRouteInfo 3: `getBusRouteList`, `getRouteInfo`, `getStaionByRoute`; arrive 1: `getArrInfoByRouteAll`; buspos 1: `getBusPosByRtid`), key `SEOUL_BUS_SERVICE_KEY`:

| Fact | Evidence |
| --- | --- |
| TOPIS's `busRouteId` for 7800 is the GBIS id `200000150` (`routeType` 8 = 경기, `corpNm` 경기, `term` 10). A second route `200000286` is `7800(예약)` | `getBusRouteList?strSrch=7800` |
| `getStaionByRoute` and `getArrInfoByRouteAll` list the **whole route, both directions, 80 stations**, the Gyeonggi part included; `transYn: Y` and `trnstnid` at seq 39 사당역 (`121001315`); `direction` 사당역 for seq 1–39, 호매실동차고지 for 40–80 | both answers |
| 19 of the 80 are virtual points named `…(미정차)`, `stationNo: "미정차"` (seq 28–30, 32–36, 40, 42, 43, 45–49, 51–53). TOPIS's `[N번째 전]` counts them | row 31 의왕톨게이트 reads `[7번째 전]` for a bus 4 real stops away |
| The 성균관대 poles carry **no ARS number**: `arsId` `"0"` on both answers for 성균관대학교 `200000162` (seq 24, toward 사당) and `200000159` (seq 58, toward 호매실), and for 성균관대역 `200000160` (seq 57). Other Gyeonggi rows carry `0`, a 4-digit number (`2944`, `1020`) or, on arrival rows only, a number `getStaionByRoute` gives as `0` | both answers |
| The 사당 poles carry Seoul ARS numbers: 사당역 `121001315` `22028` (seq 39, the median stop, alight before the turn), 사당역9번출구앞 `119000302` `20253` (seq 41, boarding toward 수원) | both answers |
| Every row has both bus slots with the Jongno fields: `arrmsg` (`곧 도착`, `출발대기` at the origin, `N분M초후[N번째 전]`, and `[0번째 전]` when the next stop is this one), `traTime` in seconds, `sectOrd`, `vehId`, `plainNo` (`경기70사1710`), `isLast`, `busType`, `mkTm` | `getArrInfoByRouteAll` |
| **No seats and no load from TOPIS**: `rerdie_Div` 2 on 78 rows, 0 on 2; `reride_Num` 0 on all 80; `full1/2` 0 on all 80 | same answer |
| Each row also carries `term` (`10`), per-stop `firstTm`/`lastTm` (성균관대학교 seq 24 05:26–23:21, 사당역9번출구앞 05:55–23:50, 성균관대학교 seq 58 06:26–00:24) and `nextBus`. The Jongno client reads none of them (`src/bus/realtime/jongro/bus-realtime-jongro.client.ts:82`) | same answer |
| `getBusPosByRtid` answers 15 vehicles with GPS, `dataTm` 0–3 min old, `trnstnid` `121001315`, `busType` 0 or 2 | `getBusPosByRtid` |

**GBIS, 4 calls** (`busrouteservice/v2` 2, `busarrivalservice/v2` 2). The data.go.kr account's one 일반 인증키 is the value of both `SEOUL_BUS_SERVICE_KEY` (stored URL-encoded) and `DATA_GO_KR_SERVICE_KEY` (stored raw): equal after URL-decoding. The calls used `SEOUL_BUS_SERVICE_KEY` and answered `resultCode 0` an hour after approval.

| Fact | Evidence |
| --- | --- |
| GBIS `stationId` equals TOPIS `stId` at all 80 positions, with the same order (`stationSeq` = TOPIS `seq`); `turnSeq` 39 | `getBusRouteStationListv2` |
| GBIS `mobileNo` for 성균관대학교 is `01013` (seq 24) and `01011` (seq 58); Seoul stops have none; 과천동행정복지센터 is `21013` in GBIS but `37034` in TOPIS. A GBIS `mobileNo` is not a Seoul ARS number and can collide with one (`01xxx` is 종로구's range) | same answer |
| First and last departures: weekday 호매실 05:00–23:50, 사당 06:00–01:00; Saturday, Sunday and holiday 호매실 05:00–23:00, 사당 06:00–00:00. Headway fields read `peekAlloc` 1 / `nPeekAlloc` 14 on weekdays, 8/10 Saturday, 10/12 Sunday (the weekday `1` looks wrong) | `getBusRouteInfoItemv2` |
| **`getBusArrivalItemv2` labels are shifted**, in JSON and XML alike: `stationNm1` holds the plate (`경기70사1720`), `lowPlate1` holds seconds (`665`, beside `predictTime1` 10), `plateNo1/2` hold `0`/`2` (the TOPIS `busType` of the same two buses), `vehId1/2` hold `N`. `predictTime`, `locationNo`, `flag`, `turnSeq`, `staOrder` match TOPIS. `remainSeatCnt1/2` read `1`/`0`, and whether that label is shifted too cannot be told from one answer | two calls 22 s apart, same values |

**data.go.kr quotas** (owner's account, 2026-10-24): TOPIS quotas are per operation per day: 버스도착정보 20,000 × 4 operations, 버스위치정보 20,000 × 5, 노선정보 10,000 × 4 (운영). GBIS 15080346 (도착), 15080648 (위치), 15080662 (노선), 15080666 (정류소): 자동승인, 개발계정 1,000/day per operation, valid to 2028-10-24; an 운영계정 is also 자동승인 but needs a registered 활용사례, and raises the cap (by how much: **Unverified**).

### Unverified

- That TOPIS keeps answering a Gyeonggi route by its GBIS id. It did on 2026-10-16 (5000, 5005, 8800 positions) and today; nothing documents it.
- TOPIS `busType` `2` on 7800: TOPIS's guide says articulated; 7800 runs double-deckers, and GBIS's `lowPlate` (shifted into `plateNo2`) reads `2` for the same bus, which in GBIS's code list is 2층. Served as `isLowFloor: null` either way (ADR 0019, D13).
- GBIS `buslocationservice/v2/getBusLocationListv2` (`remainSeatCnt`, `plateNo`, `vehId` per vehicle): not called; whether its labels are shifted too.
- That GBIS `vehId` and TOPIS `vehId` are one namespace (both 9-digit `2000…`); the shifted labels hid GBIS's.
- TAGO: not applied for; its 경기 coverage and fields (no seats) are from its public page only.

## 3. Source and quota

### 3.1 Options

| Option | Arrivals | Positions | Seats | Quota | Verdict |
| --- | --- | --- | --- | --- | --- |
| A. TOPIS only, as a fourth TOPIS route | `getArrInfoByRouteAll`, all 80 stations, both slots | `getBusPosByRtid`, GPS | none | the Jongno operations' spare (below) | **Primary.** The Jongno client, registry, route-path sync, live mapper and stop index already read exactly this |
| B. GBIS 도착 per stop | `getBusArrivalItemv2`, one stop per call, labels shifted today | none | `remainSeatCnt` (label **Unverified**) | 1,000/day per operation on 개발 | Not a live route source: one stop per call cannot fill 80 stations |
| C. GBIS 위치 per route | none | `getBusLocationListv2`, per vehicle | `remainSeatCnt` per vehicle | 1,000/day on 개발 | **Seats, later**: one call covers every bus, joined to TOPIS's vehicles by plate |
| D. TAGO | per stop | — | none | 1,000/day on 개발 (**Unverified**) | Rejected: nothing TOPIS lacks |

Fallback if TOPIS stops answering `200000150`: GBIS `getBusArrivalItemv2` for the four poles §6 names, in the same poller, `basis: provider`; the live route then states `noData` at every other station (ADR 0019, D8). Seats are not the fallback's reason.

### 3.2 Budget per operation

Interval 30 s, all day, no service window: 86,400 / 30 = 2,880 calls a day on each of the two operations. All day because TOPIS's own `운행종료` text is what makes a station `ended` (ADR 0019, D8) and a gap in the poll would make the group `noData` overnight instead; a window would save 480 calls a day and add code.

| data.go.kr operation | Today | 7800 | Total | Margin |
| --- | --- | --- | --- | --- |
| `getArrInfoByRouteAllList` | Jongno 3 × 3,456 = 10,368 (`JONGRO_POLL_INTERVAL_MS`, `src/bus/bus.constants.ts`) | 2,880 | **13,248** of 20,000 | 6,752 |
| `getBusPosByRtidList` | Jongno 10,368 + probe ≤ 2,000 (`src/infra/config.ts:178`) | 2,880 | **≤ 15,248** of 20,000 | ≥ 4,752 |
| `getArrInfoByRouteList` | 0 | 0 | 0 | the per-stop fallback inside TOPIS, untouched |
| `busRouteInfo` `getStaionByRoute`, `getRoutePath` (10,000 each) | the daily route-path sync, about 1 per route | about 1 | ~4 | — |
| GBIS `getBusLocationListv2` (1,000, 개발) | 0 | seats at 90 s, 05:00–01:00 = 800 | 800 | — |

- The planner plan's arithmetic was already per operation and right for arrivals (`transit-route-planner.md`, "Cadence and the TOPIS budget"); it left positions out because its journey poller read no positions. Joining the live route costs the positions operation 2,880 as well.
- 25 s instead of 30 s costs 3,456 a day on each operation, 576 more: arrivals at 13,824 and positions at ≤ 15,824 of 20,000, so 25 s fits. The 7800 owner (bis) keeps 30 s for now (Q4).
- A laptop's `npm run dev` polls on the same key (`docs/project-docs.md`, "Daily Usage and Quota Check"). Production's positions operation at 15,248 leaves 4,752, so a laptop polling the Jongno routes fits about 11 hours a day instead of about 17, and one also polling 7800 about 8. Hence the switch in §4.

### 3.3 Seats

TOPIS gives none (§2). Seats come from GBIS 위치 per vehicle, later (PR 7), polled where pollers run with `DATA_GO_KR_SERVICE_KEY`, which holds the same key. The server dropped that required value when skkuverse-crawler took over the public-holiday sync (2026-10-24), so PR 7 adds it back as a `poller` value, with both `config/env.*.keys` files and both Doppler configs. Before that PR: one capture of `getBusLocationListv2` beside a TOPIS answer, to check its labels and the plate join. 30 s polling needs the 운영계정.

### 3.4 API applications

Applied 2026-10-24 in the owner's data.go.kr account, each 자동승인 → 승인 at once, 개발계정, 1,000 calls a day per operation, valid to 2028-10-24:

| API | data.go.kr id | Base URL | Operations |
| --- | --- | --- | --- |
| 경기도_버스도착정보 조회 | 15080346 | `apis.data.go.kr/6410000/busarrivalservice/v2` | `getBusArrivalListv2`, `getBusArrivalItemv2` |
| 경기도_버스위치정보 조회 | 15080648 | `apis.data.go.kr/6410000/buslocationservice/v2` | `getBusLocationListv2` |
| 경기도_버스노선 조회 | 15080662 | `apis.data.go.kr/6410000/busrouteservice/v2` | `getBusRouteInfoItemv2`, `getBusRouteStationListv2`, `getBusRouteListv2`, `getBusRouteLineListv2` |
| 경기도_정류소 조회 | 15080666 | `apis.data.go.kr/6410000/busstationservice/v2` | `getBusStationListv2`, `getBusStationAroundListv2`, `getBusStationViaRouteListv2`, `busStationInfov2` |

- Not applied: TAGO 버스도착정보 (15098530) and 버스위치정보 (15098533). They carry no seats, and their 경기 coverage cannot be read without a key.
- Already held: 서울 버스도착정보 and 버스위치정보 (운영, 20,000 per operation, to 2027-08-28), 노선정보 (운영, 10,000, to 2028-10-18), 정류소정보 (개발, 1,000).
- **Keys.** A data.go.kr account has one 일반 인증키, so the new approvals attach to the key both Doppler secrets already hold (§2). No new secret and no new required variable.
- **운영계정.** Converting the 경기도 위치 API is also 자동승인 but asks for a registered 활용사례 (a public page describing the service). Needed only for seats faster than 90 s (Q7); register it once the 7800 card ships.

## 4. Poller and roles (ADR 0012)

- **Identity.** `JONGRO_ROUTES` (`src/bus/bus.constants.ts:8`) becomes the TOPIS route list with an explicit `code` per entry (`02`, `07`, `08`, `7800`), since `toJongroRoute` slices the id after `jongro` (`src/bus/bus.mapper.ts:9`), and the per-route facts the code branches on (ADR 0013, D2): `capabilities` (7800: `occupancy: false`, `lowFloor: true`, `plateNumber`, `lastBus`, `positionSource: "gps"`), `isListed` (§8, Q2) and `pollIntervalMs`. Folder and type names stay `jongro` in this plan; renaming them is Q5.
- **Poller.** `BusRealtimeJongroPoller` already registers one poller per route (`src/bus/realtime/jongro/bus-realtime-jongro.poller.ts:17`), so `poller.failing` and the Sentry check-in come per route, and 7800 is `jongro-7800` in the registry. It rejects on failure; nothing catches.
- **Writes.** `bus_cache` keys `jongro_stations_7800` and `jongro_locations_7800` (`src/bus/cache/bus-cache.document.ts:90`). The stored key prefix stays `jongro_` so a replica of the previous release reads the Jongno keys it knows during a deploy; the new keys are read only by the new release. `jongro_routes` gets 7800's stations from the arrival rows (ADR 0014, D4); `jongro_route_paths` gets its line and directions from the daily `busRouteInfo` sync (ADR 0014, D8).
- **Reads.** An api replica reads the same keys through `BusRealtimeGroupService.findJongroReading` (`src/bus/realtime/group/bus-realtime-group.service.ts:75`); no upstream call (D1). Freshness as Jongno: the group's `updatedAt` is null when nothing was written within a minute.
- **Switch.** `REGIONAL_BUS` (`src/infra/runtime-switches.ts`): on in production and test, off by default in development, gating the 7800 poller only (D5), since development spends production's quota. Off, `/bus/live/<7800 id>` serves `noData`, as for a stopped poller. The Jongno pollers stay unswitched as today.
- **Required env.** TOPIS reuses `SEOUL_BUS_SERVICE_KEY`. The GBIS seat poller (PR 7) adds `DATA_GO_KR_SERVICE_KEY` back (removed with the holiday sync on 2026-10-24) and a second switch, `GBIS`, same defaults.
- **Not served on the deprecated route.** `/bus/realtime/data/:groupId` is frozen (ADR 0019, D11): its source map (`bus-realtime-group.service.ts:110`) keeps the three Jongno routes only.

## 5. Mapping 7800 into `arrival`

Everything below is the Jongno path (`toJongroArrival`, `src/bus/live/jongro/bus-live-jongro.rules.ts:26`), unchanged, except stops away and occupancy.

| `arrival` field | 7800 | Same as Jongno? |
| --- | --- | --- |
| `status` | `arriving` for `곧 도착` and for a bus whose position stands at the station (D14); `waitingToDepart` for `출발대기` at 호매실; `enRoute` for a timed text, `[0번째 전]` included; `unknown` for a running bus with no time | yes; `[0번째 전]` is new text, pinned by the fixture |
| `expectedArrivalAt` | `mkTm + traTime`, else the time in the text (D1) | yes |
| `expectedDepartureAt`, `scheduledArrivalAt`, `scheduledDepartureAt` | null (D14; no timetable) | yes |
| `basis` | `provider` | yes |
| `stopsAway` | stopping stations before this one, plus one; the `(미정차)` stations are not counted (D4). Today the live route serves `staOrd − sectOrd + 1` (`bus-live-jongro.rules.ts:21`), which counts them | **no**: needs a pass-through rule; Jongno has no virtual station (0 of the 80 stations in `__tests__/nest/bus/fixtures/jongro-registry-routes.json`), so its answers do not change |
| `isLastBus` | `isLast1/2`, as the vehicle's (D6) | yes |
| `vehicleId` | TOPIS `vehId` (`200011532`) | yes |
| `providerText` | `arrmsg`, Korean | yes |

| `vehicle` field | 7800 |
| --- | --- |
| `plateNumber` | `plainNo`, `경기70사1710` |
| `occupancy` | null: `reride_Num` is always 0 with `rerdie_Div` 2, so the Jongno rule (`toOccupancy`, `bus-live-jongro.rules.ts:87`) would serve every 7800 bus as `relaxed` with 0 riders. Gated by the route's `capabilities.occupancy` |
| `isLowFloor` | `busType` 0 → false; 2 → null (D13) |
| `position`, `trajectory` | from `getBusPosByRtid`, as Jongno |

Station-level: `operation` per D8 from the row texts; `isPassThrough: true` on `/bus/config` for a `(미정차)` station (`src/bus/config/bus-config.mapper.ts:44` serves false for every TOPIS station today); `arsId` null where TOPIS has no 5-digit number (`toServedArsId`, `src/bus/bus.rules.ts:47`, already does this).

**Seats need a wire field.** `vehicle` has none: `occupancy` is a crowding level plus a passenger count (`src/bus/bus.wire.ts:92`). Proposal: an additive `vehicle.seatsLeft: int | null` (0 cannot be boarded) and `capabilities.seats` on `/bus/config`, recorded as ADR 0019 D17. A key of its own, not inside `occupancy`, because `occupancy` requires a level and a seat count is not one. `bus.wire.ts` is at its 96-line exemption, so the PR raises it or trims a WHY.

## 6. Stops in `bus-stops`

No production stop serves 7800 today: of the 94 stops on `GET /bus/stops` (2026-10-24), the NSC ones are `nsc-n-center` and `nsc-opposite`, shuttle stops 600 m from the 7800 poles.

| Pole | TOPIS / GBIS id | ARS | How it gets a stop |
| --- | --- | --- | --- |
| 성균관대학교, toward 사당 (seq 24) | `200000162` | none | new local stop aliasing the TOPIS id (below) |
| 성균관대학교, toward 수원 (seq 58) | `200000159` | none | same |
| 사당역9번출구앞 (seq 41, boarding toward 수원) | `119000302` | `20253` | new local stop with `arsIds: ["20253"]`, the existing alias |
| 사당역(중) (seq 39, alighting toward 사당) | `121001315` | `22028` | same, `arsIds: ["22028"]`; `subwayStationId` of 사당 when the subway registry has it (**Unverified**) |
| 성균관대역 (seq 25 `200000104`, seq 57 `200000160`) | | none / `1020` | optional, Q3 |

- **A pole without an ARS number** has no stop id today (`toPoleStopId`, `src/bus/bus.rules.ts:52`), so its station's `stopId` is null and no stop page exists. A derived `gyeonggi-<mobileNo>` is out: GBIS numbers collide with Seoul's (§2). Proposal: a local stop may alias TOPIS station ids, an optional `topisIds` beside `arsIds` (`src/bus/stops/bus-stops.document.ts`, the catalog stop type), checked at push against the stored registry like `arsIds`, and resolved by the stop index the same way. An ADR 0019 D5 note and a glossary row ("alias") record it.
- **Only aliased poles of an unlisted route enter the stop index.** Otherwise 7800 adds every pole with an ARS number (의왕톨게이트, 과천, 남태령 …) to `/bus/stops`, which the installed app lists. Listed routes keep today's rule.
- Names (ko/en/zh), coordinates (from `getStaionByRoute`'s `gpsX/gpsY`), photos and `campus: nsc` for the two 성균관대학교 stops are data. Pushes go from a main worktree, after pinging the 기획결정 session, `_dev` first; `npm run data -- check --prod` before the schema PR merges (ADR 0013, D7).

## 7. Timetable buses in the same shape

### 7.1 One producer type, the domain twin of `arrival`

```ts
// shared/stop-call.types.ts: SEE: docs/decisions/0019-bus-live-api.md
export type CallStatus = "arriving" | "enRoute" | "waitingToDepart" | "scheduled" | "unknown";
export type CallBasis = "provider" | "estimate" | "timetable";

export interface StopCall {
  status: CallStatus;
  expectedArrivalAt: Date | null;
  expectedDepartureAt: Date | null;
  scheduledArrivalAt: Date | null;
  scheduledDepartureAt: Date | null;
  basis: CallBasis;
  stopsAway: number | null;
  isLastBus: boolean | null;
  vehicleId: string | null;
  providerText: string | null;
  runId: string | null;          // a timetabled run's slot; null for a live bus
  runDepartureAt: Date | null;   // the run's departure from its first stop; null for a live bus
}
```

- **Field for field the wire's**, so the wire mapper decides nothing: `toArrival(call)` at the bus root formats four instants with `toKstInstant` and drops the run fields; the stop page's timetable entry keeps `runDepartureAt` (`src/bus/stop-arrivals/bus-stop-arrivals.wire.ts:34`).
- **Why not the planner plan's `StopCall { arrivalAt, departureAt, basis }`:** it folds the expected and scheduled pairs into one, so a stop page fed from it could no longer say "timetable 14:00, estimate 14:07". The planner reads `boardAt = expectedDepartureAt ?? scheduledDepartureAt ?? expectedArrivalAt ?? scheduledArrivalAt`, one rule.
- **`Departure`** becomes `{ lineId, board: StopCall, alight: StopCall | null, headsign, seatsLeft, observedAt }`, the same run at two stops, joined by `runId` or `vehicleId` inside the producer. `DepartureBoard`, `DepartureContinuation` and `DepartureSource` stay as the planner plan has them.
- Producers, each in the folder that owns the data: Jongno and 7800 from `findJongroReading` (uncapped per station; the live route and the stop page cap to two, D9); HSSC from the ADR 0018 engine; shuttle runs from §7.2. Every producer returns `StopCall`s from stored state and a `now` it is given, never a wire.

### 7.2 The run read, and how F1 ends

Today `BusStopArrivalsService.toShuttleEntry` reads `BusEtaSmartService.resolveSmart` (`src/bus/stop-arrivals/bus-stop-arrivals.service.ts:82`), a localized response body whose estimates `applyEstimates` already wrote as `"HH:mm"`, and `toTimetableArrivals` parses them back, with the midnight rollover guessed from the departure (`src/bus/stop-arrivals/bus-stop-arrivals.rules.ts:17`, `20`, `55`–`71`).

1. **Split the smart view.** `BusEtaSmartService` gains `listRuns(serviceId, { from, until })`: each run of the stored timetable (regular, 학부대학 `hakbu`, the commute `up`/`down`) with its stop instants as `Date`, estimates applied by the same precedence (`pickEstimates`), and the latest-estimate listing time (`pickLatestEstimates`) beside them. The stored timetable is `"HH:mm"`, so it is parsed **once, here**, from `bus_schedules`, by one rule with a test for runs past midnight. `resolveSmart` becomes "runs, then format": the smart view's `"HH:mm"` wire, its ETag and `CONTRACT(skkuverse-app)` stay byte-identical.
2. **The stop page reads runs, not the smart view.** A shuttle entry is `listRuns` → `StopCall` per run at the stop's sequence index (`board` fills the departure pair, `alight` the arrival pair, as `toRunInstants` does today) → `toArrival`. `toKstMs`, `toRunAtMs`, `toLatestStopTimesByRun` and the `SmartSchedule` import leave `bus-stop-arrivals.rules.ts`. Its `operation` comes from the run read's status, not `SmartSchedule.status`.
3. **The live entries** come from the same `StopCall`s through the same `toArrival`; `LiveGroup` stops being the stop page's input (the planner plan's "F1, step 2").

Characterization first (ADR 0010, D12): `/bus/schedule/data/:serviceId/smart` and the stop page for `nsc-n-center`, `hssc-bus-lot` and a Jongno pole are pinned on today's code; no expected value changes in 1–3.

### 7.3 What the planner reads later

`BusDeparturesService.listDepartures(query)` in `bus/departures/` over the three producers, as the planner plan describes, with one change: the 7800 line is a bus line (`source: "jongro"`, `sourceLineId` the 7800 route id) whose stop ids are §6's, not a `topisArrivals` line. Dropped from the planner plan: `journey/topis-arrivals/`, `journey_topis_arrivals`, `TOPIS_ARRIVALS_DAILY_CAP`, the `JOURNEY_TOPIS` switch and the `stops`/`serviceHours` fields of a `topisArrivals` line. The alighting estimate for a run past TOPIS's two named buses sums segment times from buses named at both ends of each segment (the planner plan's rule), now inside the bus producer. `term` is stored by the poller for the headway continuation.

## 8. PR sequence

Each PR is test-first with `the test-first workflow` (ADR 0011, D9), merges to `dev`, ships, and is checked live before the next.

| PR | Change | Tests first | On the wire |
| --- | --- | --- | --- |
| 1 | TOPIS route identity: explicit `code`, per-route `capabilities`, `isListed`, `pollIntervalMs`; the deprecated route keeps its three | `/bus/config`, `/bus/live/jongro0x` and a Jongno stop page byte-identical; `contracts/produced/` unchanged | nothing |
| 2 | 7800 fixtures captured; pass-through stations (`(미정차)`) in stops away and `isPassThrough`; occupancy gated by capability | rules specs over the 7800 fixture (`[0번째 전]`, 출발대기, 19 virtual stations); Jongno characterization unchanged | nothing (no 7800 yet) |
| 3 | `bus-stops` `topisIds` alias; unlisted routes index aliased poles only; ADR 0019 D5 note | schema and push-check specs; stop index spec | nothing until a push |
| 4 | 7800 in the route list (`REGIONAL_ROUTES`), unlisted; `REGIONAL_BUS` switch; no `jongro-route-attributes` entry (an unlisted route on no card reads none, and its source reports no load, so no seat count); quota table in `project-docs.md`; `bus.topis.quota_exceeded` and its alert | route test for `/bus/live/<id>` over the fixture; api-role boot test | new `/bus/live/<7800 id>`; then push the four stops: four new `/bus/stops` entries and their pages |
| 5 | Domain twin `StopCall` and `toArrival`; Jongno, 7800 and HSSC live mappers through it | live and stop page characterization unchanged | nothing |
| 6 | F1: `listRuns`, stop page timetable entries from runs, the `"HH:mm"` parsing deleted | smart view and stop page characterization unchanged; a past-midnight run spec | nothing |
| 7 | Seats: GBIS 위치 poller (`GBIS` switch), `vehicle.seatsLeft`, `capabilities.seats`, ADR 0019 D17 | a captured `getBusLocationListv2` fixture; plate join spec | additive `seatsLeft` (null except 7800) |
| 8 | List 7800 on `/bus/config` | config spec | a new transit-tab card; app-gated (Q2) |

PR 7 and PR 8 wait on outside facts (the GBIS capture, the app); PRs 5–6 do not depend on 7800 and can run in parallel with 2–4.

**Status (2026-10-24).** PRs 1–4 are deployed. PRs 5 and 6 are built, pinned by `__tests__/nest/bus/stop-calls-characterization.routes.test.ts`, not yet deployed: `StopCall` is in `src/bus/bus.types.ts` and `toArrival` in `src/bus/bus.mapper.ts` (the bus root, since the type derives from the wire `arrival` and `src/shared` names no feature); the run read is `BusEtaSmartService.listRuns(serviceId, { from, weekCount })` rather than `{ from, until }`, since the stop page reads the following week only when the shown week lists fewer than three runs (review F2); §7.2 step 3 is not done: the stop page's live entries still read `LiveGroup`. PR 7 is built, not deployed: one `getBusLocationListv2` capture (2026-10-24 20:22 KST, `__tests__/nest/bus/fixtures/gbis-location-7800.json`) settled both §2 Unverified items on it, since its labels are not shifted and its `vehId` is TOPIS's for the same bus, so seats join by `vehId`, not plate. The poller is `gbis-seats-7800` in `src/bus/realtime/gbis/` behind the `GBIS` switch, every 90 s from 04:50 to 02:30 KST (the weekday last bus reaches 호매실 about 02:00; at most 867 calls a day), and it writes a `bus_seats` collection rather than a `bus_cache` key, whose 60 s TTL is shorter than the tick. `vehicle.seatsLeft` is served from an answer at most 200 s old (ADR 0019, D17). `capabilities.seats` is left to PR 8, so `/bus/config` stays byte for byte.

Size and doc caps each PR must respect: `bus.wire.ts` (96), `bus-config.mapper.ts` (187), `bus-config.wire.ts` (71), `bus-realtime-group.rules.ts` (138) in `__tests__/architecture/exemptions/size-caps.json`; `docs/explanation/bus-architecture.md` is at the 200-line module-doc cap, so the PR that adds a glossary row (pass-through station, `topisIds`) trims first.

## 9. Open questions

| # | Question | Recommendation |
| --- | --- | --- |
| Q1 | 7800 as a fourth TOPIS route in the bus pipeline (this plan), or the planner plan's separate `journey/` poller | The bus pipeline: `/bus/live`, the stop page, directions, trajectories and the planner all from one poll, and no second TOPIS client |
| Q2 | List 7800 on `/bus/config` now | (An agent tooling note is left out of the public history.) |
| Q3 | Stop ids for poles with no ARS number | Local stops aliasing TOPIS station ids (`topisIds`); the two 성균관대학교 poles now, 성균관대역 only when a route uses it |
| Q4 | 30 s, or 25 s like Jongno (arrivals 13,824 and positions ≤ 15,824 of 20,000: both fit) | 30 s for now, the 7800 owner's (bis) call; 25 s fits whenever it is wanted |
| Q5 | Rename `jongro` code names (`realtime/jongro`, `JongroArrivalDoc`, …) to `topis` | Not in this sequence: a mechanical PR of its own after PR 4, stored key names unchanged |
| Q6 | Group id for 7800 (`/bus/live/:groupId`) | `gyeonggi7800`; data and app both key on it, so decide before PR 4 |
| Q7 | Seats via GBIS 위치 at 90 s on the 개발 cap, or wait for the 운영계정 | Capture first; ship at 90 s if the labels hold, register the 활용사례 in parallel |
| Q8 | GBIS's shifted labels | Report to 경기도 교통정보과 through data.go.kr's 문의; parse by value shape in the client only if the capture proves the shift is stable |

## Related

- [transit-route-planner.md](transit-route-planner.md): the planner, the dataset and the PR sequence this revises
- [ADR 0012](../decisions/0012-runtime-roles.md), [ADR 0013](../decisions/0013-runtime-data-in-mongodb.md), [ADR 0014](../decisions/0014-jongro-realtime-from-topis.md), [ADR 0019](../decisions/0019-bus-live-api.md)
- [docs/project-docs.md](../project-docs.md) ("Daily Usage and Quota Check"): the per-operation table PR 4 updates
