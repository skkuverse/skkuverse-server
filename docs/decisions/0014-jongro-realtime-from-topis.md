---
title: Jongro Realtime from TOPIS — What We Measured and Rely On
type: adr
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-10-23
audience: internal
---

# 0014. Jongro Realtime from TOPIS — What We Measured and Rely On

> The measured behavior of Seoul TOPIS that the Jongro realtime screen, the station registry and the route lines are built on, and the choices that follow from it. Read it before you change how a Jongro arrival, a tracked bus's status or the registry sync is derived, or add a TOPIS field. Accepted 2026-10-22, for what shipped in PR #275, #276, #278, #280 and #285; the rules are in [bus architecture](../explanation/bus-architecture.md).

## Context

- The poller reads `getArrInfoByRouteAll` and `getBusPosByRtid` for each route every `POLL_INTERVAL_MS`; the route-path poller reads `busRouteInfo` once a day. What the code relies on comes from production captures: 2026-10-17 (35 min at 20 s over 종로02, 07 and 08: 1,117 position rows, about 4,600 arrival predictions) and 2026-10-18 (route lines, 16 same-moment pairs).
- TOPIS's guide (data.go.kr 15000314) is wrong in places (`traTime` is seconds). The measurements are the reference.

## Decision

### D1. Arrivals are whole minutes, from TOPIS as is

Against the arrival seen in the position API, the p90 error is 60–80 s for 0–3 min predictions and 1.5–2.5 min for 3–10 min. So `minutes` is whole minutes, with no seconds countdown, and the server neither corrects TOPIS's predictions nor interpolates them between ticks.

### D2. Passenger counts are served as reported

With `rerdie_Div` 2, `reride_Num` is card taps in minus taps out (0–33 observed): it overcounts riders who skip the tap-out and falls near 0 at the terminal. The Jongro routes send type 2 (0 in about 3.5% of rows), never 4, and the position API's `congetion` is always 0. `passengerCount` is served uncorrected, and `crowding` is a coarse three-level badge against a per-route seat count.

### D3. Standing still at the origin ignores TOPIS's observation time

For a bus idling at its origin, TOPIS stops advancing `dataTm` (2026-10-18: 종로02 bus 2009 repeated its 11:55:33 observation on the next poll). Such a bus reports `stopFlag` 0 and is often on no arrival row (vehicle 100000018 sat about five minutes at ord 1 on none). So at ord 1 with `lastStTm` 0, a repeated observation counts as not moved.

TOPIS prints 곧 도착 or a time at stop 1 for such a bus: all 21 truly still origin observations had one. So `waiting` never ends on the arrival text.

### D4. The registry follows the arrival list

The station list is compared with each tick's `getArrInfoByRouteAll` rows, which name every stop with its ord, so the sync costs no call. Rejected: a daily sync from `busRouteInfo/getStaionByRoute`, one more call and schedule for a list the poller already reads every tick. The route-path poller calls `getStaionByRoute` for the map's coordinates but never writes `jongro_routes`: each collection keeps one writer.

### D5. No first or last bus times from TOPIS

`getStaionByRoute`'s per-stop `beginTm`/`lastTm` read `18:17` or `:` on 종로07 (2026-10-18), so they are neither stored nor served.

### D6. skkuverse-crawler's bus module reads the registry before it runs again

skkuverse-crawler's `bus-jongro` module, paused in production, polls TOPIS from its own copy of the route list from before the registry. It must read `jongro_routes` before it is re-enabled (`spencer0124/skkuverse#87`), and its calls count against the same TOPIS quota ([project-docs](../project-docs.md), "Daily Usage and Quota Check").

### D7. The bus type is the vehicle's, kept as TOPIS codes it

`getBusPosByRtid` names each bus's type (`busType`) and `getArrInfoByRouteAll` each slot's (`busType1`, `busType2`): `0` general, `1` low-floor, `2` articulated in TOPIS's guide. On 2026-10-23 the two agreed for every bus (종로07's 서울70사5538 read `1` on its position and on each slot naming it), and a slot with no bus read `0`. The poller keeps the three documented codes and leaves anything else out; the live route reads it per vehicle ([ADR 0019, D13](0019-bus-live-api.md)).

## Consequences

- Showing seconds, correcting a TOPIS prediction or trusting the passenger count needs new measurements first.
- Gating the origin rule on `dataTm` brings back a bus that reads `running` while it idles at its origin.
- When TOPIS changes an answer, re-measure and amend this record, not the code comments alone.
