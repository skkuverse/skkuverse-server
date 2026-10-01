---
title: Logging
type: reference
status: accepted
owner: spencer0124
last-updated: 2026-10-27
audience: internal
---

# Logging

> What a log line contains, how to write one, which lines become Sentry Issues, and what is never logged.

## A line

Production writes one JSON object per line to stdout; development pretty-prints the same object. Every line has:

| Field | Meaning |
| --- | --- |
| `time` | ISO 8601, UTC |
| `level` | `debug` · `info` · `warn` · `error` · `fatal` |
| `hostname` | The compose service that wrote it (`api-1`, `poller`, …), set per service in `docker-compose.yml` |
| `service`, `role` | `skkuverse-server`, and the `ROLE` the process runs as |
| `event` | What happened, as `domain.subject.verb` — the key to search and alert on |
| `msg` | The same thing in words, for a human scanning output |
| `reqId` | Present on every line written while serving a request; absent for pollers, boot and shutdown |

`reqId` is the client's `X-Request-Id` when well-formed, else Cloudflare's `CF-Ray`, else a UUID, and is echoed in the response's `X-Request-Id`. One id therefore finds a request's access line, every line written while serving it, and its Sentry Issue (tag `request_id`). The mechanism is an AsyncLocalStorage scope plus a pino `mixin` (`src/infra/log-context.ts`, `src/infra/http-logging.ts`), so a service logs through the shared `logger` and still gets the id.

Access lines (`msg: "request completed"`, or `"request errored"` for a 5xx) add `req` (method, masked URL, IP, a few headers), `res.statusCode`, `responseTime`, `appVersion`, `platform`, and `route`: the matched route template (`/notices/:id`), absent when no route matched. Grouping 5xx by `route` keeps one endpoint one series; the raw URL would split it into a series per id.

## Writing a line

```ts
logger.warn({ event: "bus.hssc.fetch_failed", err }, "HSSC fetch failed");
```

- **Fields first, with an `event`.** `domain.subject.verb`, lower-case, `snake_case` words: `notices.dispatch.sent`, `building.sync.completed`, `map.event_overlays.actions_dropped`. Reuse an event for the same happening in another place; never reuse one for something different.
- **A static message.** Values go in fields, where they can be grouped and filtered, not interpolated into the text.
- **`err` is the Error itself**, never `err.message` or `String(err)`. The serializer keeps the type, message, stack and `cause`, and drops request config (`src/infra/log-redact.ts`).

`eslint.config.js` enforces all three in `src/`, plus `no-console`. A variable holding a message string passed as `err` gets past the rule, so do not do it.

**A condition that recurs on every request** — a deprecated endpoint still being called, a database that stays down, a bad config served from cache — goes through `createLogThrottle` (`src/shared/log-throttle.util.ts`): one line per key per interval, with `suppressed` counting the ones skipped. An outage then costs one line a minute, not one per request.

**Expected outcomes are not errors.** A dead link upstream, an expired token, a TOPIS "no result" are answers: a 4xx/502 or a debug line, never the exception filter's 500. The filter's 500 is a Sentry Issue, reserved for faults in this code.

## Levels

| Level | Use for | Sentry |
| --- | --- | --- |
| `fatal` | The process is about to exit | An Issue through the crash handlers |
| `error` | A person should look: a 5xx, a failed send, a poller declared failing | Nothing — see below |
| `warn` | Degraded but serving, or recovering on its own | Nothing |
| `info` | Lifecycle and state changes: boot, shutdown, a sweep's result | Nothing |
| `debug` | Detail for development | Nothing; production does not write it |

Access lines take their level from the status: 5xx `error`, 4xx `warn`, but 401 and 404 `info`. `/health/*` is not logged at all.

**Error-level lines do not become Sentry Issues.** A poller logs once per failed tick, so an upstream outage would raise an event per tick. Issues come only from unknown errors reaching the exception filter (5xx), a poller being declared failing (once per failing spell), a dropped schedule override (below), and uncaught exceptions and unhandled rejections (`src/instrument.ts`).

A `bus_overrides` document that fails its schema is left out of the read, so its day serves the weekly pattern the operator closed or replaced. Because that fails open, the repository (`src/bus/schedule/bus-schedule.repository.ts`) also raises `BusScheduleDroppedOverrideError` (`src/bus/schedule/bus-schedule.error.ts`) as an Issue tagged `collection: bus_overrides`, naming each dropped document's `serviceId` and `date`, at most once an hour per document.

**Sentry is for errors, not logs.** No line goes to Sentry Logs.

## Pollers

A poller reports by resolving or rejecting; it does not log its own failures. The registry (`src/scheduling/poller-registry.service.ts`) turns outcomes into state changes, so an upstream outage costs a few lines rather than one per tick:

| Event | Level | When |
| --- | --- | --- |
| `poller.tick_failed` | debug | Any failed tick before the poller is declared failing, and between reminders |
| `poller.failing` | error | Declared: after three failed ticks in a row for a poller ticking more often than once a minute, after two for one ticking every 1 to 15 minutes, after one for slower ones. Also one Sentry Issue, tagged `poller` |
| `poller.still_failing` | warn | Every 15 minutes while it stays down |
| `poller.recovered` | info | The first success after being declared, with `failures` and `downMs` |

The poller process also checks in to a Sentry cron monitor every 5 minutes — `error` while a fast poller (under a minute between ticks) is declared failing, `ok` otherwise. A poller ticking a minute or more apart reports only through its own Issue: its `error` would last at least one interval and hide the fast pollers. Sentry raises an Issue on failed check-ins and on missing ones, which is how a dead or hung poller process is noticed.

Each `ok` check-in also pings an external heartbeat check at `HEALTHCHECKS_POLLER_PING_URL`, which alerts when the pings stop. Unset, nothing is sent. A ping that fails, answers non-2xx or takes over 5 seconds logs `poller.healthchecks_ping_failed` (warn) with the HTTP `status` or the error's `reason` (its name only), never the URL, which is the check's credential.

Upstream answers that carry no usable data throw `UpstreamError` (`src/infra/upstream.error.ts`) with the upstream's code, so they count as failures too. A TOPIS `headerCd` of `"4"` (no result) is not a failure.

A Jongro realtime poller (`jongro-<code>`) whose route has no `jongro_routes` document rejects with a `BusRegistryBootstrappingError` (`src/bus/registry/bus-registry.error.ts`), naming the route and the identical observations counted so far, until the tick that inserts the route from TOPIS resolves. A bootstrap while buses run inserts at the third tick, before the poller is declared failing; a route that stays missing (overnight on a fresh database, or TOPIS disagreeing) is declared failing, and the insert logs `poller.recovered`.

The TOPIS pollers' own lines (`src/bus/realtime/jongro/`, `src/bus/route-path/`):

| Event | Level | When |
| --- | --- | --- |
| `bus.regional.disabled` | info | At boot with `REGIONAL_BUS=off`: a regional route's poller (`jongro-7800`, `jongro-path-7800`) is not registered; one line per poller, named in `poller` |
| `bus.topis.quota_exceeded` | error | TOPIS or the data.go.kr gateway refused a call over the key's daily quota (code 22), with the data.go.kr `operation` (`getArrInfoByRouteAllList`, `getBusPosByRtidList`) and the route's `code`; at most once a minute per operation, with `suppressed`; the tick still rejects, and every route of that operation fails until the quota resets. |

The GBIS seat poller (`gbis-seats-<code>`, `src/bus/realtime/gbis/`) rejects with an `UpstreamError` that keeps the status, the GBIS result code or the gateway's reason code, and never the service key, a query parameter. Its own lines, and the live route's read of what it stores:

| Event | Level | When |
| --- | --- | --- |
| `bus.gbis.disabled` | info | At boot with `GBIS=off`: a regional route's seat poller (`gbis-seats-7800`) is not registered; one line per poller, named in `poller` |
| `bus.gbis.quota_exceeded` | warn | The data.go.kr gateway refused a call over the key's daily quota (code 22), with the `operation` (`getBusLocationListv2`) and the route's `code`; at most once a minute, with `suppressed`; the tick rejects, and the route serves no seats until the quota resets. |
| `bus.gbis.read_failed` | warn | The live route could not read `bus_seats` (a timeout, an unreachable database), with the `routeId` and `err`; at most once a minute per route, with `suppressed`. The answer is served with every `seatsLeft` null, never failed |

The arrival-estimate pollers (`shuttle-eta-live`, `shuttle-eta-baseline`, `src/bus/eta/`) reject with a `DirectionsError` or a `DailyCapError`. Either carries only the provider, a kind and a status. Neither wraps the axios error, whose config holds the API keys. A tick writes what it got before rejecting, and keeps rejecting on later ticks until a call succeeds, so an outage reads as one failing spell. Their own lines:

| Event | Level | When |
| --- | --- | --- |
| `bus.eta.disabled` | info | At boot with `SHUTTLE_ETA=off`: the pollers are not registered; one line per poller, named in `poller` |
| `bus.eta.indexes_failed` | warn | The `shuttle_eta` indexes could not be ensured at boot; the pollers still run |
| `bus.eta.read_failed` | warn | A smart schedule was served without estimates because the store read failed; at most once an hour per service, with `suppressed` |
| `bus.eta.stops_unavailable` | warn | A smart schedule was served without estimates because no `bus-stops` revision was ever read (`BUS_STOPS_UNAVAILABLE` in `err`); at most once an hour per service, with `suppressed` |
| `bus.eta.estimates_dropped` | info | A tick's write left out estimates fetched for a sequence whose stop count a `bus-stops` push changed during the tick, with `revision` and `droppedCount`; the next tick refetches them |

The api reads what the pollers wrote from `bus_cache` (`src/bus/cache/bus-cache.repository.ts`), which MongoDB empties a minute after a key's last write:

| Event | Level | When |
| --- | --- | --- |
| `bus.cache.missing` | warn | A `bus_cache` key is missing, so every role serves no bus for it ([ADR 0012](../decisions/0012-runtime-roles.md), D1); a stopped poller or a key typo. At most once a minute per `key`, with `suppressed` |

The subway pollers (`subway-seoul` every 10 s, `subway-trainmap` every 15 s, `src/subway/seoul/`) reject with a `SubwaySeoulApiError`, a `SubwaySeoulTrainmapError` or a `DailyCapError`. Each carries only its source, a status and a code, never the request URL, in whose path the API key sits. Each poller fails on its own while the other keeps the arrivals current, and outside the service window a tick calls nothing and resolves. Within a tick each call settles apart: the tracker gets what answered, then the tick rejects with the first failure, so one line's broken page still leaves the other line tracked; a tick whose every call failed tracks nothing. A train-map line whose page holds no train is not a failure until it has had none for over 30 minutes, since each line is empty for a while after the window opens; then `subway-trainmap` rejects with `seoul-trainmap: line N: no train since <ISO instant>` (`unexpected_shape`). Their own lines:

| Event | Level | When |
| --- | --- | --- |
| `subway.seoul.disabled` | info | At boot with `SUBWAY=off`: neither poller is registered |
| `subway.tracking.countdown_diverged` | info | A published countdown is over 120 s from the train's estimate; the countdown is still served while it counts ([ADR 0017](../decisions/0017-subway-arrivals.md), D5). At most once every 10 minutes per station and train, with `suppressed` |
| `subway.tracking.countdown_rejected` | info | A served train does not count its published countdown, with `reason`: `spent` (its instant has passed), `at_station` (the train is seen approaching or at the station) or `out_of_range` (it implies a delay outside −120…+2,700 s, as for a train not running yet), and `liveArrivalAt`, `estimatedArrivalAt`. At most once every 10 minutes per station and train, apart from the divergence lines, with `suppressed` |
| `subway.matching.unmatched` | info | A 신분당선 trainset event matched no timetable run (none of its direction within −120…+2,700 s, or a destination and row naming no direction) and was dropped, with `lineCode`, `unmatchedCount` and `trainsets`. At most once every 10 minutes per line, with `suppressed` |
| `subway.history.write_failed` | warn | A write of the accuracy history (`records`: `events`, `predictions`, `arrivals` or `unresolved`) failed; the tick still resolves and the served arrivals are unaffected. At most once every 10 minutes, with `suppressed` |

The mini app manifest pollers (`miniapp-manifest-<hostname>`, one per first-party origin, every 4 minutes, `src/miniapps/manifest/`) reject with a plain `Error` that names only the origin and what went wrong (`manifest 503 from <origin>`, `manifest redirected from <origin>`, a size cap, an abort or a `SyntaxError`), and store nothing on that tick. At 4 minutes each is declared on its second failed tick in a row, so a single timeout or reset that the next tick recovers from stays a `poller.tick_failed` debug line; a second is `poller.failing` and one Sentry event per failing spell. Sentry groups those events by error kind, not by origin, since the six pollers throw from the same lines; the event's `poller` tag names the origin. They write no line of their own.

`GET /miniapps/:id` reads what they stored (`MiniappsManifestService.shellFieldsFor`), one cached read for every origin:

| Event | Level | When |
| --- | --- | --- |
| `miniapps.manifest.read_failed` | warn | The stored manifests could not be read and none was read before, so each detail serves the registry's own shell (`{}` merged); at most once every 10 minutes, with `suppressed`. A failed reload after a good read logs `cache.reload_failed` instead and serves the last read |

Every reader of the mini app registry, the `miniapps` dataset, takes it through `MiniappsService.current` (`src/miniapps/`), with the read contract of every dataset: a failed reload after a good read logs `cache.reload_failed` and serves the last good revision.

| Event | Level | When |
| --- | --- | --- |
| `miniapps.registry.missing` | error | The content database holds no `miniapps` document, so the routes that need the registry answer `503 MINIAPP_REGISTRY_UNAVAILABLE`; at most once a minute, with `suppressed` |
| `miniapps.registry.invalid` | error | The stored registry fails its schema and is not served, with `revision` and `issues`; at most once a minute per revision |
| `miniapps.registry.read_failed` | error | The registry could not be read and none was read before; at most once a minute, with `suppressed` |
| `miniapps.registry.owner_mismatch` | error | A revision read disagrees with the first-party owners in `src/infra/origins.ts`, with `revision`, `path` and `reason`; once per revision per process, and the registry still serves |
| `map.event_overlays.registry_unavailable` | error | A live festival's places were served with no registry ever read, every `miniapp` button dropped, with `layerSetId`; at most once a minute, with `suppressed` |

A ui item left out because the registry revision read does not hold its mini app (`ui.home_layout.item_left_out`, `ui.campus_banners.item_left_out`, `ui.transit_layout.item_left_out`) carries `revision` and `registryRevision`, and is logged once per pair.

## Never logged

Requests and errors are logged from an allowlist (`src/infra/log-redact.ts`):

- Request headers other than those in `LOGGED_REQUEST_HEADERS` — so no `Authorization`, `Cookie` or `X-Internal-Token`.
- The value of any query parameter whose name looks like a secret (`key`, `token`, `signature`, …), in request URLs, axios error URLs, and Sentry breadcrumbs.
- On a `*.seoul.go.kr` host, the path segment before the response type (`json`, `xml`, …), where Seoul's open APIs put the key (`/api/subway/<key>/json/...`). Sentry events also get this masking on URLs quoted in their message, exception values and breadcrumb messages (`src/infra/sentry-scrub.ts`).
- An axios error's `config`, `request` and `response`, at any depth.

Sentry gets the same treatment, and its SDK is told not to collect cookies, bodies, user fields or stack-frame locals (`src/infra/sentry-options.ts`).

`__tests__/nest/infra/logging.test.ts` and `sentry.test.ts` fail if a token, cookie or service key reaches either output.

## Related

- [`src/infra/log-redact.ts`](../../src/infra/log-redact.ts) — the allowlists for headers, query values and errors
- [`src/scheduling/poller-registry.service.ts`](../../src/scheduling/poller-registry.service.ts) — the poller states and check-ins above
