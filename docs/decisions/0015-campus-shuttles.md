---
title: Campus Shuttle Timetables and Arrival Estimates
type: adr
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-10-22
audience: internal
---

# 0015. Campus Shuttle Timetables and Arrival Estimates

> What the code cannot say about the 인자셔틀 and the 자과캠 통학셔틀: what the bus and transit wire must not break in installed apps, where each stop and time came from, and why the arrival estimates use the providers and the bus-lane model they do. Read it before you change a schedule screen field or a transit item kind, a shuttle's stops or timetable, or an estimate source. Accepted 2026-10-22, for decisions made from 2026-10-08 to 2026-10-22; how it works is [bus architecture](../explanation/bus-architecture.md).

## Context

- The app's parsers copy only the fields they know. An unknown `screenType` parses as realtime, so the schedule screen renders empty; a smart `status` other than `active`, `suspended` or `noData` renders an error card; the old transit tab opens the bus realtime screen for any `action.route` it does not know. The Flutter 3.4.0 and RN 3.5.0 builds take no OTA.
- The chartered buses carry no GPS, and the school publishes no travel times (관리팀, 2026-10-08), so a directions API is the only source of an arrival time.
- No directions provider routes over the 경부고속도로 bus lane: NAVER and TMAP both price 경부 at general-lane speed.

## Decision

### D1. The wire grows by optional fields and new routes, never by new values

- **Schedule groups** gain only optional fields, an absent field meaning v1 behavior, and no new `screenType` or smart `status`. So a timetable's start and end is an effective range on its pattern: an `upcoming` status would break old builds, and `suspended` reads 운휴 before a first run.
- **A response whose shape must change becomes a new route** beside the frozen one, as `/ui/home/transit` does beside `/ui/home/transitlist`, whose `data` is a bare array.
- **A transit `link` item** targets only a webview, a mini app, an external URL or a route every build of the tab has. A native screen gets its own `kind`: a route a build lacks opens expo-router's unmatched-route screen.
- **The 강남·양재 entries keep their `notes`** ("양재역 07:45", "양재역 먼저 하차") for builds that do not read `stopTimes`.

### D2. A route is a service, a direction a route type, and a row one bus run

Rejected: services per direction (the 등교 tab would interleave five stations, and "next" would point at another station's bus); ten route × direction services (too many tabs); five groups, one per route (the owner rejected five near-identical cards); a route type per boarding stop (on the simulator, eight rows for four buses, each marked "1대", read as eight buses).

### D3. Stops and times are the school's, with these owner choices

- **인자셔틀.** Every run, 학부대학 included, uses the spots in the 관리팀 answer of 2026-10-08 ("셔틀버스 승하차 장소는 동일하게 운영"), not the different wording of the 학부대학 notice of 2026-08-28 (owner, 2026-10-09). `hakbu` stays a route type for its own times and lost-and-found contact. The second 인→자 drop-off, 복지회관 앞, is left out (owner). Drop-off times stay `null`.
- **통학셔틀.** The times are the school's 2026-10 pilot notice with its 등교 corrections of 2026-10-07, confirmed by its draft of 2026-10-08. The draft's 배차 column gives one vehicle per run, so `busCount` is 1; "8~10대 투입" is the fleet. The 하교 양재 arrival is the 강남 one minus five minutes, the gap on the 등교 runs (owner, 2026-10-08), until the school says which stop its arrival time is for. The 등교 drop-off is `nsc-n-center`, the first campus drop point, so its estimate is the arrival there (owner, 2026-10-17).

### D4. Stop photos are NAVER street view captures, checked by hand

(A collector detail is left out of the public history.)

### D5. A Seoul pole's stop id carries the `seoul-` prefix

A bare ARS number would collide with GBIS 정류소번호, also five digits, once GBIS stops are served. Rejected: `stId`, which is TOPIS-internal and not printed on the pole.

### D6. Predictions come from TMAP; live and fixed values come from NAVER

A prediction is a TMAP 타임머신 forecast for the run's own departure time; a live value is NAVER Directions 5 real-time, which takes no departure time; the fixed value is a fresh NAVER value at the scheduled departure, when the bus enters the traffic NAVER reports.

Rejected: Kakao Mobility future directions (a partner contract, and its terms forbid caching); Google Routes (no driving directions in Korea); our own medians of NAVER samples (the owner preferred one forecast value); a TMAP value in the timetable file (TMAP's 24-hour term); NAVER at departure only (nothing before the bus leaves, when riders look).

NAVER's storage terms are unconfirmed. If they restrict keeping a value, shorten `LIVE_LIFE_MS` and drop D8's reuse.

### D7. 인자셔틀 runs in lane hours take the bus lane

- **Evidence.** Car estimates ran 10–30 minutes longer than riders' trips (fixed values of 83.9 and 115 minutes on 2026-10-16). NAVER routes 인→자 via 우면산터널, 과천 and 의왕 whatever its `cartype`; forcing 경부 with waypoints made it worse (+6 to +12 minutes on NAVER, +14 on TMAP). On the corridor on a Friday at 20:35, 광역버스 GPS took 17 minutes 신갈JC→서초IC where NAVER said 25–28, and 18 southbound where NAVER said 21–22; 한국도로공사 data gave the bus lane 66–86 km/h at Friday 18:00 where TMAP priced the general lanes at 38–50.
- **Assumption.** The chartered bus always takes the lane in lane hours; the school has not confirmed it. A different answer changes `LANE_STRATEGIES` or the `bus-lane-corridor` dataset, not code.
- A run's model follows its departure time, never the tick's, so one run keeps one model from prediction to fix.
- The commute routes use the lane for 0–6% of their length (NAVER, 2026-10-17), so they stay `car`.
- A TOPIS outage pages as a live-job failure although values still serve: accepted, because the served quality drops to the car model.

### D8. The probe times the corridor from three 광역버스 routes, and predictions reuse last week

- The corridor is timed from TOPIS `getBusPosByRtidList` for routes 8800, 5000 and 5005, which cover 한남–신갈. Rejected: GBIS v2 and TAGO (our key is not registered, 403); `getArrInfoByRouteAllList` `traTime` (5–6 minutes above observed times, and it shares the Jongro quota pool); routes 5100 and 5001B (they join at 양재 or 죽전; adding them is a data change).
- A bus-lane run's prediction is the fixed value of the same slot in a recent week, which already carries the lane and the slot's city traffic, costs no call and removes the 10–30 minute jump from predicted to live.
- Deferred: a TMAP forced route plus a time-of-day profile from the stored spans, once about four weeks of spans exist.

## Consequences

- A screen type, status or transit kind an installed build lacks ships only as an optional field or a new route until those builds are gone (`/app/config` `minVersion`).
- The next semester's timetable or stop edit starts from D3's sources and owner choices, not from the 학부대학 notice or the "8~10대" answer.
- The estimates rest on two unconfirmed facts, the bus-lane route (D7) and NAVER's storage terms (D6); either answer is a constant or dataset change.
