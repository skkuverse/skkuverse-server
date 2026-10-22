---
title: Bus Live API — One Arrival Shape for Every Source
type: adr
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-10-22
audience: internal
---

# 0019. Bus Live API — One Arrival Shape for Every Source

> Why `GET /bus/live/:groupId` and the stop page serve every realtime line, Jongno and HSSC alike, and every timetabled shuttle run in one arrival and one vehicle shape, and how the old realtime route is retired. Read it before you add a source, a field or an enum value to either route. Accepted 2026-10-22; the wire and the client rules are in [bus-live-api.md](../reference/bus-live-api.md), the flows in [bus architecture](../explanation/bus-architecture.md).

## Context

- The realtime route grew route by route: TOPIS's Jongno arrivals as minutes plus TOPIS's text, its buses as an `estimated`/`tracked` union over legacy fields (`carNumber: "0000"`, `estimatedTime`, coordinates as strings), and the HSSC shuttle as positions only. A client had to know which source it read to render it.
- The HSSC shuttle now has arrival estimates ([ADR 0018](0018-hssc-arrival-estimates.md)), and a Shuttle GPS feed is collected for later. App 3.6.2 takes OTA updates, so the app moves to new routes by OTA while installed bundles keep calling the old one.
- Prior art: GTFS-Realtime (`StopTimeEvent` arrival and departure, `VehicleStopStatus`, `OccupancyStatus`), SIRI StopMonitoring (`ExpectedArrivalTime` beside `AimedArrivalTime`, `NumberOfStopsAway`, `RecordedAtTime`), TfL's Unified API (`expectedArrival`, `towards`).
- The first draft was reviewed on 2026-10-22; the decisions below fold in the accepted findings.

## Decision

### D1. Times are instants, never countdowns

An arrival carries `expectedArrivalAt` and `expectedDepartureAt` beside `scheduledArrivalAt` and `scheduledDepartureAt`, each an instant at `+09:00` or null, and a `basis` (`provider`, `estimate`, `timetable`). A countdown is wrong the moment it leaves the server; an instant is not. Two pairs, as GTFS-RT and SIRI have, because a rider at the stop wants when the bus leaves and a rider downstream when it comes. A Jongno instant is TOPIS's own prediction, `mkTm` plus `traTime` (else the time in its text), never corrected; a running bus with no time anywhere is `unknown` rather than a made-up instant.

Rejected for now: an uncertainty window. Summed per-segment spreads are no bound (ADR 0018, D5). It returns for every source at once, as the backtested error by horizon.

### D2. One shape; null is "unknown now", capabilities are "never"

Every key is always present, and what a source cannot supply is null, never a missing key or a placeholder (`"0000"`, `"----"`). What a source can never supply is stated once per group in `/bus/config` (`capabilities`: `positionSource` `gps` or `stopEvents`, `occupancy`, `plateNumber`, `lastBus`), so a client tells "this line has no plates" from "this bus's plate is unknown". A new source (the Shuttle GPS feed) changes a group's capabilities and fills fields; the shape does not move.

### D3. Every enum is open

`status`, `basis`, a position's `status`, `operation` and the stop page's entry `kind` may gain values. A client renders an arrival of a status it does not know by its `providerText`, or skips it when that is empty; it skips a stop page entry of a kind it does not know. This is why the published schemas are no reason to validate a whole response as one closed document.

### D4. Stops away counts stops, not positions

`stopsAway` is the stations with a stop the bus reaches before this one, plus one: `1` means this is its next stop, `0` that it stands here. Positions where no one boards (the HSSC's two Hyehwa Rotary passes) are never counted, so a rider reads the number as stops. A bus that just left a station is a lap away on a loop, and on the HSSC, whose lap crosses the layover, it is `waitingToDepart`. TOPIS's own count (`staOrd − sectOrd`) already is this on Jongno.

### D5. stationIndex is the key; stopId and arsId are not

- `stationIndex` keys a station inside a group: a stop can sit on a line twice (a loop's terminal, two directions of one name), a position can have no stop, and trajectories need positions.
- `stopId` is opaque and nullable on every live station, so a client opens a stop page without `/bus/config`. It resolves aliases and can change with a `bus-stops` push, so it is never a key and never derived by a client.
- `arsId` is display only: the number on a TOPIS pole's sign, which tells same-named poles apart. Null on the HSSC, whose stops show none.
- The HSSC feed's `stop_no` is never used: it differs per line for one stop. Only `seq` is stable.

Agreed with the session that owns the stop catalog, 2026-10-22.

### D6. One vehicle object per bus; two clocks on its position

A response lists each vehicle it mentions once and arrivals point at it by `vehicleId`: TOPIS counts passengers per station row, so copies of one bus inside each arrival would disagree. A vehicle an arrival names without a position row is served with `position: null`.

A position carries `positionAt`, when the source saw the bus there, and `checkedAt`, when this server last fetched that answer. A stop-event source repeats its last event until the next stop, so its `positionAt` is minutes old while the bus is fine; a dead feed shows in `checkedAt`. A client dims and freezes a marker on `checkedAt`'s age and extrapolates along the trajectory from `positionAt`. Each group carries `updatedAt`, its poller's last write (the staler key for Jongno), so "no buses" and "the poller stopped" differ.

### D7. Loops wrap

A trajectory's `s` is a station index plus the fraction of the section, as the Jongno trajectory always was, and the HSSC's comes from the engine's stop instants, so every marker moves the same way. On a group with `isLoop: true`, `s` may pass the last index: a client places the marker at `s mod stationCount`, the section after the last station leading back to station 0. Jongno 02, whose station list repeats its terminal, is not a loop.

### D8. Operation is stated per station

A station is `ended` when the source says the line is done there (every TOPIS slot 운행종료), `noData` when it says it has nothing (정보없음), `running` otherwise; a group is `ended` when every station is, `running` when any is, `noData` otherwise. The HSSC states nothing, so its stations are `running` while a fresh bus exists and the group is `noData` otherwise; `ended` waits for its published service hours.

So that the last bus of the day is not dropped mid-layover, the live route keeps a bus laying over at 농구장 for 15 minutes (the layover's p90 is 846 s, ADR 0018 D2). The deprecated route keeps its 3.

### D9. Arrivals in the order they serve the station

A bus at the station first (standing there, or laying over at its own turnaround, the one a rider boards), then by expected arrival, then the buses behind a layover by stops away; at most two per live station (TOPIS's first and second bus) and three runs per timetabled service at a stop.

### D10. The client owns the minute rule

The server serves instants and `meta.serverNow`; the client keeps its clock offset (the largest `serverNow − receipt` over the last five responses) and shows `max(1, round(remaining / 60))` minutes, 곧 도착 when the status is `arriving` or under a minute remains, still for up to two minutes overdue, then drops the arrival until the next poll. `arriving` is set only from the source, never from the server's clock.

### D11. The old realtime route is frozen, then removed

`GET /bus/realtime/data/:groupId` keeps every byte of its body, a characterization test pins them, and it answers `Deprecation` (RFC 9745) and `Link: rel="successor-version"`. `/bus/config` names each realtime group's `liveEndpoint` and never repoints `dataEndpoint`, which installed bundles call. The app sends its native version (`X-App-Version`) and platform but no OTA bundle id, and old and new bundles share native version 3.6.2, so the old route's hits are counted as hits: any call to it comes from a bundle older than the migration. `Sunset` is added, and the route removed, once that traffic is gone.

### D12. The stop page is one route of the same shape

`GET /bus/stops/:stopId/arrivals` lists a `live` entry per realtime group (exactly the live route's station entry for the same stored state, with `towards`, the next station with a stop) and a `timetable` entry per shuttle service, whose runs are `scheduled` arrivals carrying `runDepartureAt`, so a run with no time at the stop still sorts and labels. A run is listed until its time at the stop passes: the timetable's or the served estimate's where the page shows one, else the arrival of its latest estimate (the newest fetched among its unexpired ones, served or not), else its departure, while the page shows only the served estimate. The page was reshaped in place, since no installed app read it.

## Consequences

- No user sees the new routes before the OTA, so there is no mixed state; the client takes over the minute and 곧 도착 rules (D10).
- Two measured weekdays back the HSSC estimates (ADR 0018); a month of `hssc_feed_events` and TOPIS captures is the planned revision, and the window of D1 with it.
- A run at an alighting stop has no timetable time there, so it is listed until the arrival of its most recently fetched unexpired estimate, even a live value older than the 15 minutes the smart view serves one, then the baseline prediction, and only with neither by its departure (owner, 2026-10-22). That estimate decides only the listing: the page shows the served estimate or none, so a stale value never shows as a time, and a run can leave the list before a served prediction it still shows. The smart view applies it from the same cached read (`BusEtaSmartService.resolveLatestEstimates`); a run of the following week keeps its served estimate.
- TOPIS's low-floor and full-bus flags (`busType`, `isFullFlag`) are not cached; adding them to the vehicle is additive.
