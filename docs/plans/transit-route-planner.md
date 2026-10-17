---
title: Transit Route Planner
type: plan
status: draft
owner: zoyoong124@gmail.com
last-updated: 2026-10-17
audience: internal
---

# Transit Route Planner

> The direction for the 길찾기 cards (혜화역 → 인사캠, 인사캠 ↔ 자과캠): what each option needs, where every number comes from, the common departure format, and how legs chain with transfer time. Nothing here is built yet; check each claim against `src/` before starting, and delete items as they land.

## Goal

The map sheet shows one card per corridor (best option, "N분 후 출발", total time), and each card opens a list of options with a time bar and legs (walk, ride, transfer, arrive). The design mock-ups were made on 2026-10-17.

The total must be honest: each ride leg boards **the first vehicle the user can actually catch** after the previous leg plus walking or transfer time, not the next vehicle at the time of the request.

The order of work: **normalize every source into one departure format first**; chaining them is a small pure function once that exists.

## Options per corridor

| Corridor | Option | Legs |
| --- | --- | --- |
| 혜화역 → 인사캠 | 종로07 | walk → 종로07 at `혜화역1번출구` → walk |
| | 셔틀 | walk → HSSC shuttle at 혜화역 1번 출구 → walk |
| | 도보 | walk only (static) |
| 인사캠 → 자과캠 | 택시 | taxi |
| | 인자셔틀 | walk → 인자셔틀 (600주년기념관) → walk |
| | 4호선 · 7800 | walk → 4호선 혜화 → 사당 → transfer → 7800 at 사당역9번출구앞 → walk |
| | 1호선 (later) | 종로02/08 → 종각/종로5가 → 1호선 → 성균관대역 |
| 자과캠 → 인사캠 | the reverse of each | 7800 boards at 성균관대학교 (서울행), then 4호선 사당 → 혜화, then 종로07 |

> [!WARNING]
> Both 7800 "성균관대학교" stops are about 110 m from the NSC back gate and about 750 m from the main gate. A leg that ends at "자과캠 정문" after 7800 is wrong; end it at the back gate or lengthen the walk.

## Data source per mode

| Mode | Next departures | Ride time | Status |
| --- | --- | --- | --- |
| HSSC shuttle (혜화역) | bus sequence + segment-time table − dwell seconds | ~6 min to 600주년 | to build; see [HSSC shuttle estimate](#hssc-shuttle-estimate) |
| 종로07 | TOPIS `exps1`/`exps2` (seconds) from the response the jongro poller already fetches | static | store two more fields |
| Subway (4호선, 1호선) | timetable + live delay at the served stations | **the same train's arrival** at the alighting station, from the timetable | widen the timetable range |
| 7800 | TOPIS `arrive/getArrInfoByRouteAll` (one call per poll for the whole route) | difference of TOPIS per-stop predictions | to build |
| 7800 seats | GBIS `busarrivalservice/v2` `remainSeatCnt1/2`, on demand, cached | — | needs the data.go.kr dataset application |
| 인자셔틀 | `src/bus/schedule/` next departure | `src/bus/eta/smart/` | exists |
| Taxi | leave now | TMAP car route, cached per origin–destination pair for ~5 min | to build; reuse the TMAP key `src/bus/eta/forecast/` uses |

> [!NOTE]
> Do not reuse the 인자셔틀 ETA as the taxi time: during bus-lane hours it is computed with the bus-lane strategy (`src/bus/eta/lane/bus-lane.json`), and a taxi cannot use the lane.

## Common departure format

Every source gets an adapter that answers `listDepartures(boardStop, after)` with one shape. Two fields exist because the chaining step needs them, not the sources.

```ts
interface Departure {
  at: Date;            // departure from the boarding stop, absolute
  arriveAt?: Date;     // arrival at the alighting stop, when known per vehicle (subway timetable)
  vehicleId?: string;
  seatsLeft?: number;  // 7800 only; 0 means it cannot be boarded (no standing passengers)
  realtime: boolean;   // false: from a timetable or a headway estimate
}

interface DepartureBoard {
  departures: Departure[];   // sorted by `at`
  observedAt: Date;          // when the upstream produced the data (TOPIS `mkTm`, poll time)
  beyond:                    // how to estimate departures after the last one listed
    | { kind: "timetable" }                 // the list already covers the day
    | { kind: "headway"; minutes: number }  // TOPIS `term`, a configured headway
    | { kind: "none" };                     // no more service today (e.g. 종로07 on a Sunday)
}
```

- **Absolute times, anchored at `observedAt`.** TOPIS `exps1` counts from `mkTm`, not from the request. Adding it to `now` after a 30–40 s poll and a cache read shows a bus up to 40 s later than it is. The existing `JongroArrivalDoc.eta` string has this problem today.
- **`beyond.kind: "none"` is not a failure.** An upstream that did not answer drops that option with a logged reason; it never falls back to a headway silently.
- Each adapter starts with a mapper test over a real response kept as a fixture.

## Chaining

```text
t = now
for leg in option.legs:
  walk / transfer: t += leg.minutes
  ride:
    dep = first departure with at >= t and seatsLeft != 0
    none listed: estimate from `beyond` (timetable, else t + headway / 2), realtime = false
    leg.wait = dep.at - t          // the red "N분" in the mock-up
    t = dep.arriveAt ?? dep.at + leg.rideMinutes
total = t - now
"N분 후 출발" = first ride's dep.at - the walk before it
```

Realtime only reaches the first leg or two. TOPIS lists two vehicles per stop, so a 7800 boarded at 사당 ~40 min from now is almost always beyond it. Such legs carry `realtime: false` and the app shows "약 N분". Seat counts matter most when 7800 is the first leg (자과캠 → 사당).

## API shape

- The corridors, options and legs are a static JSON file under `src/ui/transit/` (a new sub-module, following `src/building/`). Each mode module exposes only its `.service` (ADR 0010).
- `GET /ui/transit/routes`: one card per corridor, the best option only.
- `GET /ui/transit/routes/:id`: every option with total minutes, minutes until departure, time-bar segments (`kind`, `minutes`, `color`) and legs (label, stop name, wait minutes, `realtime`).
- Both are `@CacheControl("no-store")`: the values are live.

```jsonc
{
  "id": "hssc-to-nsc",
  "options": [
    { "id": "taxi", "legs": [{ "kind": "taxi", "from": "hssc-gate", "to": "nsc-backgate" }] },
    {
      "id": "line4-7800",
      "legs": [
        { "kind": "walk", "minutes": 15 },
        { "kind": "ride", "source": "subway", "board": "S1-4-420", "alight": "S1-4-433" },
        { "kind": "transfer", "minutes": 5 },
        { "kind": "ride", "source": "gbus7800", "board": "119000302", "alight": "200000159" },
        { "kind": "walk", "minutes": 2 }
      ]
    }
  ]
}
```

## Work items

Ordered so the format is settled on the easiest source first and 7800 waits for its key.

1. **종로07 adapter.** Store `exps1`, `exps2`, `arrmsg2` and `mkTm` from the TOPIS rows `src/bus/realtime/jongro/bus-realtime-jongro.client.ts` already fetches; map to `DepartureBoard`. Check: `grep -n exps src/bus/realtime/jongro/bus-realtime-jongro.client.ts`.
2. **Subway.** Widen the station range in `scripts/subway-timetable/convert.py` (4호선 to 사당 `0433`; 1호선 north of 금정 toward 서울역/종로5가) and add `listDepartures(from, to, after, n)` to `SubwayTimetableService`. Keep the planner's timetable **separate from the tracker's**: the awaited-train estimate counts from a train's first stop in the file (`src/subway/estimate/subway-estimate.rules.ts`), so a wider file shifts live estimates by tens of minutes. Do not make 사당 or 금정 served stations: each served station adds a realtime arrival call every tick and the daily cap (`src/infra/config.ts`) would be exceeded.
3. **HSSC shuttle adapter.** Departures from 혜화역 per bus from the segment table below, plus a log of sequence changes (the poller already tracks `firstSeenAt`) to replace the estimates with measured medians.
4. **인자셔틀 adapter** over the schedule and the smart ETA; keep the Friday queue warning and the 학부대학 shuttle.
5. **7800.** A poller for TOPIS `getArrInfoByRouteAll` (~2,400 calls a day at 30 s over service hours, inside its 20,000 quota; give it its own cap, not `topisDailyCap`), and a GBIS seat lookup on demand behind `createCachedLoader`.
6. **Taxi.** A TMAP car-route client, one call per pair, cached ~5 min.
7. **Routes JSON, chaining, the two routes and their contract tests.**

## HSSC shuttle estimate

The shuttle API gives each bus's last passed station (its sequence in `HSSC_ETA_STATIONS`, `src/bus/station/bus-station.constants.ts`) and how long it has been there (`estimatedTime`, dwell seconds, not an ETA). Today `src/bus/station/bus-station.rules.ts` turns that into "N 정거장 전" only.

Estimated segment times (2026-10-17), in the API's numbering:

| From → to | Minutes | Cumulative to 혜화역(승차장) |
| --- | --- | --- |
| 1 정차소(농구장) → 2 학생회관 | 1 | 10 + dispatch wait |
| 2 → 3 정문(하교) | 2 | 9 |
| 3 → 4 혜화로터리(하차지점), via the 국민생활관 and 우체국 drop-offs | 4 | 7 |
| 4 → 5 혜화역U턴지점 | 2 | 3 |
| 5 → 6 혜화역(승차장) | 1 | 1 |
| 6 → 10 600주년 기념관 (inbound ride) | 1 + 1 + 2 + 2 | ride ≈ 6 |

```text
eta(bus) = max(0, cumulative[bus.sequence] - bus.estimatedTime)
```

- A bus at sequence 1 waits for its dispatch slot: add the remaining headway and label it as waiting to depart.
- Buses at sequences 7–10 are inbound and a full loop away; leave them out.
- Evidence: the inbound times come from the operator's route-admin screen sent by the SKKU 관리팀 (혜화역 07:00 → 성균관대입구사거리 07:03 → 정문 07:05 → 농구장 07:07). Its outbound rows are not monotonic (unedited defaults), so the outbound times are estimated from distance. The 3 → 4 segment carries the most error; measure it first.

## 7800 reference

As found on 2026-10-17. Route `200000150` (경진여객, 호매실동차고지 ↔ 사당역(중)); a separate reservation route `200000286` exists.

| Use | Stop | Stop no. | stationId | staOrder |
| --- | --- | --- | --- | --- |
| Board at 사당 (to Suwon) | 사당역9번출구앞 | 20253 | 119000302 | 41 |
| Alight at 사당 (from Suwon) | 사당역(중) | 22028 | 121001315 | 39 |
| Board at NSC (to Seoul) | 성균관대학교 | 01013 | 200000162 | 24 |
| Alight at NSC (from Suwon side) | 성균관대학교 | 01011 | 200000159 | 58 |

- 사당역9번출구앞 is boarding only and exists only toward Suwon; 사당역(중) is alighting only.
- TOPIS returns the whole route, Gyeonggi stops included, but no seat counts (`reride_Num1` was `0` on every stop while GBIS showed 68 and 44 free seats on the same buses).
- GBIS `https://apis.data.go.kr/6410000/busarrivalservice/v2` (`getBusArrivalItemv2`: `stationId`, `routeId`, `staOrder`, `format=json`) returns `predictTimeSec1/2`, `remainSeatCnt1/2` (`-1` = unknown), `plateNo1/2`, `vehId1/2`. Unverified: no approved key yet, so no live response has been seen.
- Key: `SEOUL_BUS_SERVICE_KEY` is the data.go.kr account key, so no new secret is needed once the dataset `경기도_버스도착정보 조회` (data.go.kr/data/15080346) is approved. The development tier allows 1,000 calls a day; move to the operating tier and request more before polling.

## Open questions

- The GBIS response shape and whether its `vehId` matches TOPIS `vehId`.
- Whether the Seoul API returns timetables for 4호선 stations south of 남태령 (Korail-operated, e.g. 금정); `findTimetable` keys a timetable by operator and line only.
- TMAP's daily quota for the car-route call.
- Static walk and ride minutes per leg (혜화역 1번 출구 ↔ stop, 사당 4호선 ↔ 9번 출구 transfer) need a walk-through or a measured source.

## Related

- [docs/explanation/subway-architecture.md](../explanation/subway-architecture.md) — what adding a station touches
- [docs/explanation/bus-architecture.md](../explanation/bus-architecture.md) — the pollers and estimates
- [docs/explanation/ui-architecture.md](../explanation/ui-architecture.md) — the `/ui/*` routes
