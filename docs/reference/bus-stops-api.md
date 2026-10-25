---
title: Bus Stops API Reference
type: reference
status: draft
owner: zoyoong124@gmail.com
last-updated: 2026-10-25
audience: internal
---

# Bus Stops API

> The contract for `GET /bus/stops`, the stop list of every stop with its coordinates and routes, and `GET /bus/stops/:stopId/arrivals`, the stop page: one answer per stop with every route the server serves there, each live line's arrivals as the live route serves them and the next shuttle runs, in one arrival shape ([ADR 0019](../decisions/0019-bus-live-api.md)), and for the `stopId` each realtime station of `/bus/config` links it by. Read it before building a screen on the response. How stops are identified and indexed is [explanation/bus-architecture.md](../explanation/bus-architecture.md); what each part's data is and how to edit it is [how-to/edit-bus-stops.md](../how-to/edit-bus-stops.md).

## Summary

| | |
| --- | --- |
| Route | `GET /bus/stops/:stopId/arrivals`; the stop list, `GET /bus/stops`, has [its own summary](#get-busstops) |
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

A pole a local stop aliases (`arsIds` in `bus-stops`, or `topisIds` for a pole TOPIS gives no ARS number; pushed only after an on-site confirmation) resolves to that local stop: `seoul-<ARS number>` answers the local stop's page, whose `stop.id` is the slug. Without an alias two sources stay two stops, however close: `hssc-600th` and `seoul-01616` are two pages. A route that lists a pole twice, as 종로02 lists its terminal `01881` first and last, serves it at its first index only. A route `/bus/config` does not list (7800) adds only the poles a local stop aliases.

## Stop ids on the realtime stations

Each station of a realtime group (`hssc`, `jongro02`, `jongro07`, `jongro08`) in `GET /bus/config` and `GET /bus/config/:groupId` carries `stopId`, its last field, the id of its stop page:

| Station | `stopId` |
| --- | --- |
| An HSSC position | The `bus-stops` `hssc.stations[].stopId`; no key at the two non-stop 혜화동로터리 positions (indexes 5 and 7) |
| A Jongno station | `seoul-<stationNumber>`, or the local stop aliasing that ARS number; no key for a virtual stop (ARS number empty or `0`). A pole a route lists twice (종로02's `01881`) carries its id at both indexes |

```json
{ "index": 16, "name": "혜화역1번출구", "subtitle": null, "stationNumber": "01592", "isFirstStation": false, "isLastStation": false, "isRotationStation": false, "isPassThrough": false, "isAlightOnly": false, "transferLines": [{ "line": "4", "color": "00A5DE" }], "stopId": "seoul-01592" }
```

Every other field keeps its value and order, and the schedule groups and `stationEtas[]` gain nothing: removing every `stopId` key leaves the body served before the field, which is what installed apps parse (`parseRealtimeStation` reads named fields only). The field is `stopId` in `busGroup` (`src/bus/config/bus-config.wire.ts`), optional in `contracts/produced/bus-config.busGroup.schema.json`, with the fixtures `realtime-hssc-stop-ids.json` and `realtime-jongro07-stop-ids.json`.

| | |
| --- | --- |
| ETag | Each realtime group's and the all-groups ETag changed once when the field shipped, in every language; an alias push changes the ETags of the groups whose stations it renames and the all-groups ETag, and no other |
| Never read | While a replica has never read a good `bus-stops`, the Jongro groups answer `503 BUS_STOPS_UNAVAILABLE` with no `Cache-Control`, like `/bus/config` and the `hssc`, `campus` and `commute` groups; `fasttrack` and the realtime data routes still serve |
| Following one | `/bus/stops/<stopId>/arrivals` answers its page, or `404 BUS_STOP_NOT_FOUND` once the stop is gone (a pole TOPIS removed, a slug retired by a later alias): a client reads that as "stop gone" |

## GET /bus/stops

The stop list: every stop a served route stops at, once, with where it is and which routes stop there, for the map's stop pins, its 정류장 place category and a realtime line's station list. It carries no arrivals: a pin, a line's station or a list row opens the stop page by `id`.

| | |
| --- | --- |
| Wire type | `busStopList` in `src/bus/stop-list/bus-stop-list.wire.ts`, published as `contracts/produced/bus-stop-list.busStopList.schema.json`; fixture `contracts/produced/fixtures/bus-stop-list.busStopList/hssc-shuttle-and-poles.json`, trimmed to five stops |
| Controller | `src/bus/stop-list/bus-stop-list.controller.ts` |
| Envelope | `{ meta: {}, data: { stops } }`: one body for every language, so no `meta.lang` and no `Accept-Language` in it |
| `Cache-Control` | `public, max-age=300`; `public, max-age=60` while a Jongno route's registry or the route lines cannot be read |
| `ETag` | `"stops-<md5 of the body>"`; `If-None-Match` with it answers `304` with no body. The body derives from the `bus-stops` revision (its stop areas included, through `stopAreaId`), every stored stations version and every stored route line, so the tag moves when one of them changes what is served |
| Tests | `__tests__/nest/bus/bus-stop-list.routes.test.ts`, the specs under `src/bus/stop-list/` and `BusStopIndexService.listStops` in `src/bus/stop-index/bus-stop-index.service.spec.ts` |

```json
{
  "meta": {},
  "data": {
    "stops": [
      {
        "id": "hssc-hyehwa-exit1",
        "name": { "ko": "혜화역 1번출구", "en": "Hyehwa Station (Shuttle Bus Stop)", "zh": "Hyehwa Station (Shuttle Bus Stop)" },
        "coords": { "lat": 37.5836601, "lng": 127.0018387 }, "arsIds": null, "campus": "hssc", "stopAreaId": null,
        "routes": [{ "kind": "live", "groupId": "hssc", "label": { "ko": "인사캠 셔틀버스", "en": "HSSC Shuttle Bus", "zh": "人文校区班车" }, "stationIndex": 6, "towards": { "ko": "성균관대입구사거리", "en": "SKKU Junction", "zh": "SKKU Junction" }, "action": "board" }]
      },
      {
        "id": "jeongja-exit3",
        "name": { "ko": "정자역 3번 출구", "en": "Jeongja Stn. Exit 3", "zh": "亭子站 3号出口" },
        "coords": { "lat": 37.365499, "lng": 127.107906 }, "arsIds": null, "campus": null, "stopAreaId": null,
        "routes": [{ "kind": "timetable", "groupId": "commute", "label": { "ko": "정자", "en": "Jeongja", "zh": "亭子" }, "serviceId": "commute-jeongja", "routeType": "up", "action": "board" }]
      },
      {
        "id": "seoul-01592",
        "name": { "ko": "혜화역1번출구", "en": "혜화역1번출구", "zh": "혜화역1번출구" },
        "coords": { "lat": 37.5834729904, "lng": 127.0017632862 }, "arsIds": ["01592"], "campus": "hssc", "stopAreaId": null,
        "routes": [
          { "kind": "live", "groupId": "jongro07", "label": { "ko": "종로 07", "en": "Jongro 07", "zh": "钟路 07" }, "stationIndex": 16, "towards": { "ko": "혜화동로터리", "en": "혜화동로터리", "zh": "혜화동로터리" }, "action": "board" },
          { "kind": "live", "groupId": "jongro08", "label": { "ko": "종로 08", "en": "Jongro 08", "zh": "钟路 08" }, "stationIndex": 22, "towards": { "ko": "혜화동로터리", "en": "혜화동로터리", "zh": "혜화동로터리" }, "action": "board" }
        ]
      }
    ]
  }
}
```

### A listed stop

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | The stop id the stop page takes and a realtime station of `/bus/config` serves as `stopId`; a pole a local stop aliases is listed once, under the local stop's slug |
| `name` | `{ ko, en, zh }` | Each is what a request in that language is served on the stop page: a local stop's name, falling back to English, then Korean; a Jongno pole's stored TOPIS name, Korean in all three |
| `coords` | `{ lat, lng }` or `null` | The stop's own `coords` in `bus-stops`, else its pole's on the stored route line; `null` while it has neither: a pole while the route lines cannot be read, or a local stop stored without `coords` (a push refuses a served stop without them, [edit-bus-stops.md](../how-to/edit-bus-stops.md), but the read still serves a revision stored before that check). A client draws no pin for `null`. A realtime station's coordinates are its stop's: join `/bus/config` `station.stopId` on `id` |
| `arsIds` | string array or `null` | The ARS numbers of the TOPIS poles it stands for: a pole's own, or those a local stop aliases, as stored; `null` for a local stop whose entry has no `arsIds`, where the stop page leaves `stop.arsIds` out. A local stop stored with an empty `arsIds` is served `[]`, as on its stop page |
| `campus` | `"hssc"`, `"nsc"` or `null` | A catalog stop's `campus` in `bus-stops`: `hssc` for a stop on the HSSC campus, `nsc` for one on the NSC campus, left out for a commute station stop, which serves neither; without one, `hssc` for a Jongno pole or a local stop aliasing one, since all three Jongno routes serve the HSSC campus, else `null` |
| `stopAreaId` | string or `null` | The [stop area](#stop-areas) that holds the stop; `null` when none does |
| `routes` | array | One entry per served route at the stop, in the stop page's order, without arrivals |

| Entry | Fields |
| --- | --- |
| A realtime line, `kind: "live"` | `groupId`, `label` (`{ ko, en, zh }`, the group's label), `stationIndex` (its index in the group's `/bus/config` stations), `towards` and `action`, each what the stop page's live entry serves in that language: `towards` is `{ ko, en, zh }`, the next station with a stop (a Jongno station's Korean name in all three; on the HSSC loop the next stop as its catalog stop is named), and `null` when the stop is the line's last station, its 종점; `action` is `alight` at an HSSC drop-off-only station, else `board` |
| A shuttle, `kind: "timetable"` | `groupId`, `label` (`{ ko, en, zh }`, the service's label, which names its direction, so it has no `towards`), `serviceId`, `routeType` and `action` (`board` or `alight`) |

`kind` is an open enum, as on the stop page: parse each entry on its own and skip one whose `kind` the build does not know.

### Order

The stop index's order, which is stable while its sources stay: the HSSC line's stops in line order, then the shuttle sequences' stops (`campus`, then `commute`, each service and route type in `/bus/config`'s order), then each Jongno route's poles in station order (종로02, 07, 08), each stop where it first appears. 종로02's loop terminal `01881` is listed once, and a pole two routes share once, at the first route that reaches it. A screen that sorts by distance or name sorts itself.

### Errors and partial answers

| Status | `error.code` | When |
| --- | --- | --- |
| `503` | `BUS_STOPS_UNAVAILABLE` | This replica has never read a good `bus-stops` value; no `Cache-Control`, as on the stop page |

There is no `404`. A Jongno route whose stored registry cannot be read is left out, with the poles only it stops at, logged at error as `bus.stop_index.registry_unread`; while the route lines cannot be read, poles are listed with `coords: null`, logged at warn as `bus.stop_index.coords_unavailable`. Both answer `200` with the one-minute `Cache-Control`, and each log line comes at most once a minute.

Every read goes through the caches the stop page already uses (the `bus-stops` dataset loader, the registry's and the route lines' cached loaders), one route-lines read per request, so the list costs no MongoDB read once they are warm and adds no read path.

## GET /bus/stops/:stopId/arrivals

`Cache-Control: no-store`, like `/bus/live/:groupId`: the page carries live arrivals and positions, and the client polls it. Names and labels follow `Accept-Language` (ko, en, zh). `meta.serverNow` is the server's clock, which the client's clock offset is read from, as on the live route.

```json
{
  "meta": { "lang": "ko", "serverNow": "2026-10-20T14:10:00+09:00" },
  "data": {
    "stop": { "id": "seoul-01592", "name": "혜화역1번출구", "coords": { "lat": 37.5834729904, "lng": 127.0017632862 }, "arsIds": ["01592"], "stopAreaId": null },
    "routes": [
      {
        "kind": "live", "groupId": "jongro07", "label": "종로 07", "stationIndex": 16, "towards": "혜화동로터리", "direction": { "id": "100900220", "label": "성균관대운동장 방면" }, "action": "board",
        "stationsVersion": "0346768f2b776f45", "updatedAt": "2026-10-20T14:09:55+09:00", "operation": "running",
        "vehicles": [{ "id": "100000203", "plateNumber": "서울74사2703", "occupancy": { "level": "relaxed", "passengerCount": 9 }, "seatsLeft": null, "isLastBus": false, "position": { "...": "..." }, "trajectory": [] }],
        "arrivals": [{
          "status": "enRoute", "expectedArrivalAt": "2026-10-20T14:13:50+09:00", "expectedDepartureAt": null,
          "scheduledArrivalAt": null, "scheduledDepartureAt": null, "basis": "provider",
          "stopsAway": 2, "isLastBus": false, "vehicleId": "100000203", "providerText": "4분10초후[2번째 전]"
        }]
      },
      { "kind": "live", "groupId": "jongro08", "label": "종로 08", "stationIndex": 22, "towards": "혜화동로터리", "direction": { "id": "100900040", "label": "명륜3가 방면" }, "action": "board", "stationsVersion": "52e82cc449046288", "updatedAt": null, "operation": "noData", "vehicles": [], "arrivals": [] }
    ]
  }
}
```

The example is the fixture `contracts/produced/fixtures/bus-stop-arrivals.busStopArrivals/seoul-01592.json`, its vehicle's position trimmed. Beside it, `hssc-bus-lot.json` is a shuttle stop with timetable entries and a 종로07 live entry, served over a test store in which it aliases 종로07's pole `01618`: an illustration of an alias only, since production aliases no pole (none is confirmed on site, [edit-bus-stops.md](../how-to/edit-bus-stops.md#add-an-alias)). `hssc-hyehwa-exit1.json` is an HSSC stop with two buses on their way, and `hssc-olympic-hall.json` a drop-off-only HSSC stop, whose live entry's `action` is `alight`.

### The stop

| Field | Type | Meaning |
| --- | --- | --- |
| `stop.id` | string | The canonical stop id: the slug of an aliased pole's local stop, else the id asked for |
| `stop.name` | string | A local stop's name in the request language, falling back to English, then Korean; a Jongno pole's stored TOPIS name, which is Korean in every language |
| `stop.detail` | string, optional | A local stop's detail, as `/bus/config` serves it |
| `stop.coords` | object, optional | `{ lat, lng }`: the stop's own, else its pole's on the stored route line; left out while it has neither, where the stop list serves `coords: null` |
| `stop.photoUrl`, `stop.streetViewUrl`, `stop.subwayStation` | optional | As the stop's `/bus/config` record serves them |
| `stop.arsIds` | string array, optional | The ARS numbers of the TOPIS poles the stop stands for: a pole's own, or the ones a local stop aliases, as stored (an empty `arsIds` is served `[]`); left out for a local stop whose entry has none |
| `stop.stopAreaId` | string or `null` | The [stop area](#stop-areas) that holds the stop, as the stop list serves it; `null` when none does |

A local stop's block is its `/bus/config` record (`screen.stops[]`) without `map`, which belongs to a group's screen, plus `stopAreaId`: `/bus/stops/jeongja-exit3/arrivals` in `en` serves the same `stop` as `/bus/config/commute` in `en`, with `stopAreaId` added.

### Routes

`routes` lists one entry per served route at the stop, in the order `/bus/config` lists its groups (`hssc`, `campus`, `commute`, then each Jongno route), then a group's services and route types. Only routes the server serves appear; no TOPIS route outside 종로02, 07 and 08 is listed. Each entry's `kind` names what it serves and fixes its fields: `live` (a realtime line, Jongno or HSSC) or `timetable` (a shuttle). It is an open enum: a client switches on `kind` alone and skips an entry of a kind it does not know.

The published schema (`contracts/produced/bus-stop-arrivals.busStopArrivals.schema.json`) is a closed `oneOf` over today's two kinds, so a client must not parse `routes` as one array against it: an entry of a kind added later would fail the whole page. Parse each entry on its own and leniently, keep the ones that parse, and skip an entry whose `kind` this build does not know, or that fails to parse, without dropping the stop block or the other entries.

| Entry | Fields |
| --- | --- |
| A realtime line, `kind: "live"` | `groupId` (`hssc`, `jongro07`), `label`, `stationIndex` (its index in the group's `/bus/config` stations), `towards` (below), `direction` (below), `action` (`alight` at a drop-off-only HSSC stop, where riders may only get off, else `board`; always `board` on Jongno: the same field a timetable entry carries, [ADR 0019, D15](../decisions/0019-bus-live-api.md)), `stationsVersion` (a Jongno route's, `null` for HSSC), `updatedAt` and `operation` (the station's, `noData` where the live route states nothing), `vehicles` (those its arrivals name) and `arrivals`: exactly the live route's station entry at that index for the same stored state, so a bus standing at the stop is first, `arriving` with `stopsAway: 0` and no departure instant ([ADR 0019, D14](../decisions/0019-bus-live-api.md)) |
| A shuttle, `kind: "timetable"` | `groupId` (`campus`, `commute`), `label` (the service's label), `serviceId`, `routeType`, `action` (`board` or `alight`), `operation` (the smart schedule's status: `running` when active, `suspended` or `noData`), `vehicles` (always empty) and `arrivals`, empty unless `operation` is `running` |

A live entry's `towards` is the next station with a stop, so a client tells a line's two directions apart at one stop:

| Line | `towards` |
| --- | --- |
| HSSC | The next stop past the rotary passes, named as its own stop page names it: its `bus-stops` stop's name in the request language, falling back to English, then Korean, never the line row's name (`올림픽기념국민생활관`, not `올림픽기념국민생활관 [하차전용]`). The loop always has one |
| Jongno | The next station's stored TOPIS name, Korean in every language; `null` at the route's last index |

`null` means the stop is the line's last station: the bus ends its run there, so a client shows 종점 in place of a direction.

A live entry's `direction` is the line's 방면 the station lies on, `{ id, label }` exactly as the group's `/bus/config` station names it (`directionId`) with that direction's `label` in the request language ([bus-live-api.md](bus-live-api.md#directions), [ADR 0019, D16](../decisions/0019-bus-live-api.md)): at `seoul-01592` 종로07 heads to `성균관대운동장 방면` and 종로08 to `명륜3가 방면`; at `hssc-olympic-hall` the HSSC line is `하교`. It is `null` where the station has none: a Jongno route with no stored route line or one not yet synced with directions, a config placed by another stations version than the page's entry, or a group config that cannot be built (another route's registry missing), while the entry and the rest of the page still serve. `towards` is the next stop and `direction` the terminal side of the line; a client shows both, or `direction` alone as the tab name.

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
| `503` | `JONGRO_REGISTRY_UNAVAILABLE` | While a Jongno route's stored registry cannot be read: a `seoul-` pole that neither a readable route nor an alias names, or a local stop that aliases a pole (`arsIds`) and that no readable route serves |

A Jongno route whose stored registry cannot be read is left out of the stop index, logged at error as `bus.stop_index.registry_unread` at most once a minute, and read again at most every `REGISTRY_RETRY_MS`; an aliased pole on it still answers its local stop's page. A route whose other source cannot be read (its attributes for a Jongno entry, the timetable for a shuttle entry) is left out of `routes` and logged at error as `bus.stop_arrivals.route_left_out`, at most once a minute per route. Either way the rest of the page is served with `200`. A Jongno entry whose live answer was placed by another stations version than the index (a TOPIS sync between the two reads) is left out of that one response.

## Stop areas

A stop area groups the stops a rider would call one place, such as the poles on both sides of one subway exit, so that a journey planner can offer it as one place to pick ([ADR 0022, D4](../decisions/0022-journey-and-call-spec.md)). It is for picking only: the stop list still lists each stop once with its own pin, and each stop keeps its own page. `stopAreaId` on a listed stop and on a page's `stop` is the area's id, which no stop id ever takes, or `null`. An area's coordinates are its members' centroid, derived and never served here. Areas are stored in `bus-stops` (`stopAreas`, [edit-bus-stops.md](../how-to/edit-bus-stops.md#add-a-stop-area)); none is stored yet. A member TOPIS drops at runtime is left out of its area and logged at warn as `bus.stop_index.stop_area_member_unmatched`, at most once a minute, while the rest is served.

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
