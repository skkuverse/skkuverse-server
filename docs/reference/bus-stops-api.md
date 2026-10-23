---
title: Bus Stops API Reference
type: reference
status: draft
owner: zoyoong124@gmail.com
last-updated: 2026-10-22
audience: internal
---

# Bus Stops API

> The contract for `GET /bus/stops/:stopId/arrivals`, the stop page: one answer per stop with every route the server serves there, each live line's arrivals as the live route serves them and the next shuttle runs, in one arrival shape ([ADR 0019](../decisions/0019-bus-live-api.md)), and for the `stopId` each realtime station of `/bus/config` links it by. Read it before building a screen on the response. How stops are identified and indexed is [explanation/bus-architecture.md](../explanation/bus-architecture.md); what each part's data is and how to edit it is [how-to/edit-bus-stops.md](../how-to/edit-bus-stops.md).

## Summary

| | |
| --- | --- |
| Route | `GET /bus/stops/:stopId/arrivals` |
| Auth | none |
| Rate limit | `GeneralRateLimitMiddleware`, bound to `bus/stops` in `BusModule.configure` (`src/bus/bus.module.ts`) |
| Wire type | `busStopArrivals` and `busStopArrivalsMeta` in `src/bus/stop-arrivals/bus-stop-arrivals.wire.ts`, published as `contracts/produced/bus-stop-arrivals.busStopArrivals.schema.json`; its arrivals and vehicles are `bus.arrival` and `bus.vehicle`, as on the live route ([bus-live-api.md](bus-live-api.md)) |
| Controller | `src/bus/stop-arrivals/bus-stop-arrivals.controller.ts` |
| Sources | the `bus-stops` dataset, the stored Jongno registry (`jongro_routes`) and route lines (`jongro_route_paths`), `bus_cache`, `jongro-route-attributes`, the stored timetables and `shuttle_eta`; no upstream call |
| Envelope | `{ meta: { lang, serverNow }, data }` through the global `ResponseInterceptor` |
| Tests | `__tests__/nest/bus/bus-stop-arrivals.routes.test.ts`, and the specs under `src/bus/stop-index/` and `src/bus/stop-arrivals/` |

## Stop ids

A stop id names one physical pole, never a place, and is opaque to clients. It matches `^[a-z0-9]+(-[a-z0-9]+)*$`.

| Kind | Id | Example | Where it comes from |
| --- | --- | --- | --- |
| Jongno pole | `seoul-<ARS number>` | `seoul-01592` (혜화역1번출구, served by 종로07 and 종로08) | Derived from the stored registry station; never stored. A station whose ARS number is empty or `0` has none |
| Shuttle stop | the dataset's slug | `hssc-bus-lot`, `nsc-n-center`, `jeongja-exit3` | `bus-stops` `stops[].id`, as `/bus/config` serves it in `screen.stops[].id` and `stopSequences[].stopId` |
| HSSC stop | the dataset's slug | `hssc-hyehwa-exit1` | `bus-stops` `hssc.stations[].stopId`; the two non-stop 혜화동로터리 positions have none |

A pole a local stop aliases (`arsIds` in `bus-stops`, pushed only after an on-site confirmation) resolves to that local stop: `seoul-<ARS number>` answers the local stop's page, whose `stop.id` is the slug. Without an alias two sources stay two stops, however close: `hssc-600th` and `seoul-01616` are two pages. A route that lists a pole twice, as 종로02 lists its terminal `01881` first and last, serves it at its first index only.

## Stop ids on the realtime stations

Each station of a realtime group (`hssc`, `jongro02`, `jongro07`, `jongro08`) in `GET /bus/config` and `GET /bus/config/:groupId` carries `stopId`, its last field, the id of its stop page:

| Station | `stopId` |
| --- | --- |
| An HSSC position | The `bus-stops` `hssc.stations[].stopId`; no key at the two non-stop 혜화동로터리 positions (indexes 5 and 7) |
| A Jongno station | `seoul-<stationNumber>`, or the local stop aliasing that ARS number; no key for a virtual stop (ARS number empty or `0`). A pole a route lists twice (종로02's `01881`) carries its id at both indexes |

```json
{ "index": 16, "name": "혜화역1번출구", "subtitle": null, "stationNumber": "01592", "isFirstStation": false, "isLastStation": false, "isRotationStation": false, "isPassThrough": false, "transferLines": [{ "line": "4", "color": "00A5DE" }], "stopId": "seoul-01592" }
```

Every other field keeps its value and order, and the schedule groups and `stationEtas[]` gain nothing: removing every `stopId` key leaves the body served before the field, which is what installed apps parse (`parseRealtimeStation` reads named fields only). The field is `stopId` in `busGroup` (`src/bus/config/bus-config.wire.ts`), optional in `contracts/produced/bus-config.busGroup.schema.json`, with the fixtures `realtime-hssc-stop-ids.json` and `realtime-jongro07-stop-ids.json`.

| | |
| --- | --- |
| ETag | Each realtime group's and the all-groups ETag changed once when the field shipped, in every language; an alias push changes the ETags of the groups whose stations it renames and the all-groups ETag, and no other |
| Never read | While a replica has never read a good `bus-stops`, the Jongro groups answer `503 BUS_STOPS_UNAVAILABLE` with no `Cache-Control`, like `/bus/config` and the `hssc`, `campus` and `commute` groups; `fasttrack` and the realtime data routes still serve |
| Following one | `/bus/stops/<stopId>/arrivals` answers its page, or `404 BUS_STOP_NOT_FOUND` once the stop is gone (a pole TOPIS removed, a slug retired by a later alias): a client reads that as "stop gone" |

## GET /bus/stops/:stopId/arrivals

`Cache-Control: no-store`, like `/bus/live/:groupId`: the page carries live arrivals and positions, and the client polls it. Names and labels follow `Accept-Language` (ko, en, zh). `meta.serverNow` is the server's clock, which the client's clock offset is read from, as on the live route.

```json
{
  "meta": { "lang": "ko", "serverNow": "2026-10-20T14:10:00+09:00" },
  "data": {
    "stop": { "id": "seoul-01592", "name": "혜화역1번출구", "coords": { "lat": 37.5834729904, "lng": 127.0017632862 }, "arsIds": ["01592"] },
    "routes": [
      {
        "kind": "live", "groupId": "jongro07", "label": "종로 07", "stationIndex": 16, "towards": "혜화동로터리",
        "stationsVersion": "0346768f2b776f45", "updatedAt": "2026-10-20T14:09:55+09:00", "operation": "running",
        "vehicles": [{ "id": "100000203", "plateNumber": "서울74사2703", "occupancy": { "level": "relaxed", "passengerCount": 9 }, "isLastBus": false, "position": { "...": "..." }, "trajectory": [] }],
        "arrivals": [{
          "status": "enRoute", "expectedArrivalAt": "2026-10-20T14:13:50+09:00", "expectedDepartureAt": null,
          "scheduledArrivalAt": null, "scheduledDepartureAt": null, "basis": "provider",
          "stopsAway": 2, "isLastBus": false, "vehicleId": "100000203", "providerText": "4분10초후[2번째 전]"
        }]
      },
      { "kind": "live", "groupId": "jongro08", "label": "종로 08", "stationIndex": 22, "towards": "혜화동로터리", "stationsVersion": "52e82cc449046288", "updatedAt": null, "operation": "noData", "vehicles": [], "arrivals": [] }
    ]
  }
}
```

The example is the fixture `contracts/produced/fixtures/bus-stop-arrivals.busStopArrivals/seoul-01592.json`, its vehicle's position trimmed. Beside it, `hssc-bus-lot.json` is a shuttle stop that aliases a 종로07 pole, with timetable and live entries, and `hssc-hyehwa-exit1.json` an HSSC stop with two buses on their way.

### The stop

| Field | Type | Meaning |
| --- | --- | --- |
| `stop.id` | string | The canonical stop id: the slug of an aliased pole's local stop, else the id asked for |
| `stop.name` | string | A local stop's name in the request language, falling back to English, then Korean; a Jongno pole's stored TOPIS name, which is Korean in every language |
| `stop.detail` | string, optional | A local stop's detail, as `/bus/config` serves it |
| `stop.coords` | object, optional | `{ lat, lng }`: the stop's own, else its pole's on the stored route line; an HSSC stop has none |
| `stop.photoUrl`, `stop.streetViewUrl`, `stop.subwayStation` | optional | As the stop's `/bus/config` record serves them |
| `stop.arsIds` | string array, optional | The ARS numbers of the TOPIS poles the stop stands for: a pole's own, or the ones a local stop aliases |

A local stop's block is its `/bus/config` record (`screen.stops[]`) without `map`, which belongs to a group's screen: `/bus/stops/jeongja-exit3/arrivals` in `en` serves the same `stop` as `/bus/config/commute` in `en`.

### Routes

`routes` lists one entry per served route at the stop, in the order `/bus/config` lists its groups (`hssc`, `campus`, `commute`, then each Jongno route), then a group's services and route types. Only routes the server serves appear; no TOPIS route outside 종로02, 07 and 08 is listed. Each entry's `kind` names what it serves and fixes its fields: `live` (a realtime line, Jongno or HSSC) or `timetable` (a shuttle). It is an open enum: a client switches on `kind` alone and skips an entry of a kind it does not know.

The published schema (`contracts/produced/bus-stop-arrivals.busStopArrivals.schema.json`) is a closed `oneOf` over today's two kinds, so a client must not parse `routes` as one array against it: an entry of a kind added later would fail the whole page. Parse each entry on its own and leniently, keep the ones that parse, and skip an entry whose `kind` this build does not know, or that fails to parse, without dropping the stop block or the other entries.

| Entry | Fields |
| --- | --- |
| A realtime line, `kind: "live"` | `groupId` (`hssc`, `jongro07`), `label`, `stationIndex` (its index in the group's `/bus/config` stations), `towards` (the next station with a stop: on a Jongno route the next station's name, `null` at the last index; on the HSSC loop the next station past the rotary passes), `stationsVersion` (a Jongno route's, `null` for HSSC), `updatedAt` and `operation` (the station's, `noData` where the live route states nothing), `vehicles` (those its arrivals name) and `arrivals`: exactly the live route's station entry at that index for the same stored state, so a bus standing at the stop is first, `arriving` with `stopsAway: 0` and no departure instant ([ADR 0019, D14](../decisions/0019-bus-live-api.md)) |
| A shuttle, `kind: "timetable"` | `groupId` (`campus`, `commute`), `label` (the service's label), `serviceId`, `routeType`, `action` (`board` or `alight`), `operation` (the smart schedule's status: `running` when active, `suspended` or `noData`), `vehicles` (always empty) and `arrivals`, empty unless `operation` is `running` |

A timetable entry lists up to three runs, each an arrival ([bus-live-api.md](bus-live-api.md)) with `status: "scheduled"`, `stopsAway`, `vehicleId` and `providerText` null, and one more field:

| Field | Meaning |
| --- | --- |
| `runDepartureAt` | The run's departure from its first stop: its identity, so a run with no time at this stop still sorts and labels |
| `scheduledDepartureAt`, `expectedDepartureAt` | At a boarding stop: the timetable's time here, or the smart schedule's estimate when one was applied at an estimated stop. Timetable data, so a run keeps them; a live arrival's are always null |
| `scheduledArrivalAt`, `expectedArrivalAt` | The same at an alighting stop |
| `basis` | `estimate` when the time here is an estimate, else `timetable` |
| `isLastBus` | `true` for the day's last run of the route type |

A run is listed while its time at this stop is not before the current minute in Asia/Seoul, and runs are ordered by that same time: the timetable's time where one is shown; otherwise (an alighting stop, whose timetable stores no time) the later of the arrival of its most recently fetched estimate, even one too old to be shown, and the expected time shown, or its departure when it has neither. The fields above still carry only the served estimate, so a run can be listed with no time at this stop. A time before the departure is the next day's. When the smart schedule's week holds fewer than three, the runs continue into the following week, as the smart schedule would show it: a Friday evening after the last run lists the next Monday's, and a day of no service or inside a suspension lists none. Boarding and drop-off stops are both served.

### Errors

| Status | `error.code` | When |
| --- | --- | --- |
| `404` | `BUS_STOP_NOT_FOUND` | The id is malformed, or no served route stops at it (`seoul-99999`, a pole TOPIS removed) |
| `503` | `BUS_STOPS_UNAVAILABLE` | This replica has never read a good `bus-stops` value; no `Cache-Control` |
| `503` | `JONGRO_REGISTRY_UNAVAILABLE` | A `seoul-` pole is asked for while a Jongno route's stored registry cannot be read, and neither a readable route nor an alias names the pole |

A Jongno route whose stored registry cannot be read is left out of the stop index, logged at error as `bus.stop_index.registry_unread` at most once a minute, and read again at most every `REGISTRY_RETRY_MS`; an aliased pole on it still answers its local stop's page. A route whose other source cannot be read (its attributes for a Jongno entry, the timetable for a shuttle entry) is left out of `routes` and logged at error as `bus.stop_arrivals.route_left_out`, at most once a minute per route. Either way the rest of the page is served with `200`. A Jongno entry whose live answer was placed by another stations version than the index (a TOPIS sync between the two reads) is left out of that one response.

## Freshness and cost

| Source | Bound |
| --- | --- |
| A `bus-stops` push | within a minute (the dataset's TTL), which rebuilds the stop index |
| A TOPIS stop list change | within the registry's `REGISTRY_TTL_MS`: a pole TOPIS adds gets a page with its Korean name, a pole it removes answers `404` |
| Jongno and HSSC positions and arrivals | `bus_cache`'s `MEMORY_TTL_MS` per replica, the live route's own read |
| Shuttle runs and estimates | the smart schedule's week cache and estimate cache, the smart route's own reads |
| A pole's coordinates | the route lines' `ROUTE_PATHS_TTL_MS` |

Every read goes through a cache the other bus routes already keep, so a page costs no MongoDB read once they are warm, and the reads per process are bounded by those caches' TTLs, not by the request rate.

## Related

- [explanation/bus-architecture.md](../explanation/bus-architecture.md): stop ids, the stop index and the invariants
- [how-to/edit-bus-stops.md](../how-to/edit-bus-stops.md): what a stop page shows, where each part comes from, and how to change it
- [subway-api.md](subway-api.md): the subway station page, the same one-route shape
