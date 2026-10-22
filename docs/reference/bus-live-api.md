---
title: Bus Live API Reference
type: reference
status: draft
owner: zoyoong124@gmail.com
last-updated: 2026-10-22
audience: internal
---

# Bus Live API

> The contract for `GET /bus/live/:groupId`: a realtime line's vehicles and the next arrivals at each of its stations, in one shape for the Jongno routes and the HSSC shuttle, and what a client computes from it. Read it before building a line screen on the response. Why the shape is what it is: [ADR 0019](../decisions/0019-bus-live-api.md); where the data comes from: [explanation/bus-architecture.md](../explanation/bus-architecture.md).

## Summary

| | |
| --- | --- |
| Route | `GET /bus/live/:groupId`, for a realtime group of `/bus/config` (`hssc`, `jongro02`, `jongro07`, `jongro08`) |
| Auth | none |
| Rate limit | `GeneralRateLimitMiddleware`, bound to `bus/live` in `BusModule.configure` (`src/bus/bus.module.ts`) |
| Wire type | `liveGroup` and `liveGroupMeta` in `src/bus/live/bus-live.wire.ts`, published as `contracts/produced/bus-live.liveGroup.schema.json`; its arrival and vehicle are `bus.arrival` and `bus.vehicle` (`src/bus/bus.wire.ts`) |
| Controller | `src/bus/live/group/bus-live-group.controller.ts` |
| Sources | `bus_cache` (each poller's last answer and when it wrote it), the stored Jongno registry and route attributes, and the `bus-stops` dataset; no upstream call |
| Envelope | `{ meta: { lang, serverNow }, data }`; `Cache-Control: no-store` |
| Tests | `__tests__/nest/bus/bus-live.routes.test.ts`, and the specs under `src/bus/live/` |

## Example

```json
{
  "meta": { "lang": "ko", "serverNow": "2026-10-20T10:00:00+09:00" },
  "data": {
    "groupId": "hssc",
    "stationsVersion": null,
    "updatedAt": "2026-10-20T09:59:55+09:00",
    "operation": "running",
    "vehicles": [{
      "id": "32149", "plateNumber": null, "occupancy": null, "isLastBus": null,
      "position": {
        "stationIndex": 6, "status": "inTransit", "progress": null, "sectionMeters": null, "coords": null,
        "nextStationAt": "2026-10-20T10:00:20+09:00", "positionAt": "2026-10-20T09:59:50+09:00", "checkedAt": "2026-10-20T09:59:55+09:00"
      },
      "trajectory": [{ "at": "2026-10-20T09:59:50+09:00", "s": 6 }, { "at": "2026-10-20T10:00:20+09:00", "s": 7 }]
    }],
    "stations": [{
      "stationIndex": 8, "stopId": "hssc-skku-junction", "arsId": null, "operation": "running",
      "arrivals": [{
        "status": "enRoute", "expectedArrivalAt": "2026-10-20T10:01:42+09:00", "expectedDepartureAt": null,
        "scheduledArrivalAt": null, "scheduledDepartureAt": null, "basis": "estimate",
        "stopsAway": 1, "isLastBus": null, "vehicleId": "32149", "providerText": null
      }]
    }]
  }
}
```

Trimmed from the fixtures in `contracts/produced/fixtures/bus-live.liveGroup/`: a Jongno route, and the HSSC line running, laying over, wrapping its loop and with no bus.

## The group

| Field | Type | Meaning |
| --- | --- | --- |
| `groupId` | string | As asked |
| `stationsVersion` | string \| null | A Jongno route's stations version, as `/bus/config` serves it: refetch the config when they differ. Null for the HSSC line |
| `updatedAt` | instant \| null | When the group's poller last wrote what this answer is built from (for Jongno, the staler of its arrivals and positions). Null when nothing is cached: the poller has not written for a minute, which differs from a poller that writes no bus |
| `operation` | enum | `running` when any station is, `ended` when every station is, `noData` otherwise (nothing stated, or only 정보없음) |
| `vehicles` | array | Every vehicle the answer mentions, once |
| `stations` | array | Every station the source states something for: an arrival or an operation. Every Jongno station TOPIS reports, stop or not; every HSSC stop while a bus is fresh, never its two rotary passes |

Every instant is ISO 8601 at `+09:00`, to the second.

## Stations

| Field | Type | Meaning |
| --- | --- | --- |
| `stationIndex` | int | The station's index in the group's `/bus/config` stations: the key inside the group |
| `stopId` | string \| null | The stop page's id (`GET /bus/stops/:stopId/arrivals`), so a client opens a stop without reading `/bus/config`. Opaque: it resolves aliases and can change with a stops push, so never store it as a key and never build one from an ARS number |
| `arsId` | string \| null | The five-digit number on a TOPIS pole's sign, for display (it tells 종로07's two 성균관대정문 poles apart). Null on the HSSC line and at a virtual Jongno stop |
| `operation` | enum | `ended` when TOPIS says the line is done there (every slot 운행종료), `noData` when it says it has nothing (정보없음), `running` otherwise. The HSSC line states nothing: `running` while a bus is fresh |
| `arrivals` | array | At most two, who serves the station first |

## Arrivals

One bus at one station. Every key is always present; null means unknown.

| Field | Type | Meaning |
| --- | --- | --- |
| `status` | enum | Below |
| `expectedArrivalAt` | instant \| null | When it reaches this station |
| `expectedDepartureAt` | instant \| null | When it leaves it: a bus standing here |
| `scheduledArrivalAt`, `scheduledDepartureAt` | instant \| null | The timetable's; null on a live line |
| `basis` | enum | `provider` (TOPIS predicted it), `estimate` (this server did, from the HSSC engine) or `timetable` |
| `stopsAway` | int \| null | The stations with a stop the bus reaches first, plus one: `1` its next stop, `0` standing here. A bus that just left is a lap away on a loop. Null when TOPIS names no vehicle |
| `isLastBus` | boolean \| null | Null on the HSSC line |
| `vehicleId` | string \| null | A key of `vehicles`; null when the source names no vehicle (TOPIS's 출발대기 slot) |
| `providerText` | string \| null | The upstream's own text as received (TOPIS `arrmsg`, Korean); null on the HSSC line |

| `status` | Meaning | Instants |
| --- | --- | --- |
| `atStop` | Standing at this station | `expectedDepartureAt` |
| `arriving` | The source says it is about to arrive (TOPIS 곧 도착); never set from the server's clock | `expectedArrivalAt` when TOPIS gives a time |
| `enRoute` | On its way | `expectedArrivalAt` |
| `waitingToDepart` | Must still leave its origin or turnaround first (TOPIS 출발대기, the HSSC 농구장 layover) | none |
| `scheduled` | A timetable run with no live vehicle (the stop page only) | the scheduled pair, the estimate when one exists |
| `unknown` | The source sent something this server cannot classify, or a running bus with no time anywhere | none: render `providerText` |

A Jongno instant is TOPIS's own: when it made the row (`mkTm`) plus its travel time, else plus the time in its text. An HSSC instant is the engine's, from the measured medians ([ADR 0018](../decisions/0018-hssc-arrival-estimates.md)); it never crosses the layover, so a bus that must lay over first is `waitingToDepart`.

Order: a bus at the station first (standing there, or laying over at its own turnaround, the one a rider boards there), then `arriving` and `enRoute` by instant, then `waitingToDepart` by `stopsAway`. On Jongno the order is TOPIS's first and second bus.

## Vehicles

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Stable for the service day: TOPIS `vehId`, the HSSC line number (one line is one bus) |
| `plateNumber` | string \| null | The full plate (`서울74사5537`); shorten it on the client if the design wants the last four digits |
| `occupancy` | object \| null | `{ level: "relaxed" \| "normal" \| "crowded", passengerCount: int \| null }`, from the TOPIS row nearest ahead of the bus |
| `isLastBus` | boolean \| null | From the same row; null when no row names the bus |
| `position` | object \| null | Null for a bus an arrival names but no position row has |
| `trajectory` | array \| null | Knots `{ at, s }`, ascending; null when the bus is not moving or has no position |

| `position` field | Type | Meaning |
| --- | --- | --- |
| `stationIndex` | int | The last station passed or stood at |
| `status` | enum | `inTransit`, `atStop` or `waitingToDepart` |
| `progress` | number \| null | `0..1` along the section, when the source measures it (GPS) |
| `sectionMeters` | int \| null | The section's length, when known |
| `coords` | `{ lat, lng }` \| null | Numbers |
| `nextStationAt` | instant \| null | When it reaches the next station |
| `positionAt` | instant | When the source saw the bus there (TOPIS `dataTm`, the HSSC event's time) |
| `checkedAt` | instant | When this server last fetched that answer |

## Open enums

Every enum may gain a value. A client that meets one it does not know:

| Field | Fallback |
| --- | --- |
| arrival `status` | Render `providerText` when it is non-empty, else skip the arrival |
| `basis` | Treat as `estimate` |
| position `status` | Treat as `inTransit` |
| `operation` | Treat as `running` and render the arrivals |
| occupancy `level` | Hide the badge |

Parse each station and each vehicle on its own: one that fails to parse is skipped, never the whole answer.

## What the client computes

- **Clock.** `offset` is the largest `serverNow − receipt` over the last five responses (the app's `server-clock.rules.ts`).
- **Minutes.** `remaining = expectedArrivalAt − (deviceNow + offset)`. Show `max(1, round(remaining / 60))` minutes; show 곧 도착 when `status` is `arriving` or `remaining ≤ 60 s`, and keep showing it while the arrival is overdue by up to two minutes; past that, drop the arrival until the next poll replaces it.
- **Markers.** Dim a marker when `checkedAt` is more than 120 s old and freeze it past 180 s, whatever `positionAt` says: a stop-event source repeats its last event until the next stop, so a minutes-old `positionAt` is normal. Move a marker along `trajectory` between knots, linearly, against `serverNow`, and hold it at the last knot.
- **Loops.** On a group whose `/bus/config` `isLoop` is true, `s` may pass the last index: place the marker at `s mod stationCount`, the section after the last station leading back to station 0. Jongno 02, whose station list repeats its terminal, is not a loop.

## In /bus/config

Each realtime group's `screen` in `GET /bus/config` and `GET /bus/config/:groupId` ends with three fields; every other field, `dataEndpoint` included, keeps its value, since installed bundles call whatever `dataEndpoint` says.

| Field | `hssc` | `jongro02`, `jongro07`, `jongro08` | Meaning |
| --- | --- | --- | --- |
| `liveEndpoint` | `/bus/live/hssc` | `/bus/live/<groupId>` | This route, which the app moves to by OTA |
| `isLoop` | `true` | `false` | Whether a trajectory's `s` may pass the last index |
| `capabilities.positionSource` | `stopEvents` | `gps` | Open enum: `gps` brings coordinates and progress |
| `capabilities.occupancy`, `.plateNumber`, `.lastBus` | `false` | `true` | Whether the source can ever supply them: `false` means always null, `true` that a null is unknown right now |

Each realtime group's ETag and the all-groups ETag changed once, in every language, when the fields shipped.

## Errors

| Status | `error.code` | When |
| --- | --- | --- |
| `404` | `GROUP_NOT_FOUND` | No `/bus/config` group has that id |
| `404` | `GROUP_NOT_LIVE` | A schedule group (`campus`, `fasttrack`, `commute`) |
| `503` | `BUS_STOPS_UNAVAILABLE` | This replica has never read a good `bus-stops` value, which names each station's stop |
| `503` | `JONGRO_ROUTE_ATTRIBUTES_UNAVAILABLE`, `JONGRO_REGISTRY_UNAVAILABLE` | A Jongno route's attributes or registry cannot be read |

## Related

- [ADR 0019](../decisions/0019-bus-live-api.md): the decisions behind the shape
- [bus-stops-api.md](bus-stops-api.md): the stop page, which serves the same station entry
