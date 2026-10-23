---
title: Subway Arrivals and Public Holidays — Sources, Budget and Accuracy Policy
type: adr
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-10-22
audience: internal
---

# 0017. Subway Arrivals and Public Holidays — Sources, Budget and Accuracy Policy

> The decisions behind `src/subway/` and `src/calendar/` that the code cannot show: what the upstreams measured, which sources we may lean on, the call budget, how accuracy may be improved, and where holidays come from. Read it before you change a subway source, a polling window, an estimate rule or how a holiday is decided. Accepted 2026-10-22, for what shipped from 2026-10-17; how it works is [subway architecture](../explanation/subway-architecture.md) and [holidays architecture](../explanation/calendar-architecture.md), the per-line quirks [subway-api.md](../reference/subway-api.md) ("Upstream data notes").

## Context

- The Seoul real-time subway API cannot be shown as it comes. Measured on 2026-10-16 near 성균관대, a Korail section: `barvlDt` is always 0 there; 4 departed trains were still listed as "도착" 89–145 s later, because a Korail section never reports a departure; one response held 7 duplicate rows, 2 ghost trains and timestamps in the future. The merge rules (newest row per train, no future rows, departures from the train map, only scheduled trains served) answer these.
- The Seoul Metro train map (`smss.seoulmetro.co.kr`) shows departures, Korail sections included, but has no timestamps and was sometimes behind the API (train 0496, 2026-10-16).
- Every estimate is measured: `subway_predictions` against observed arrivals, reported by `GET /internal/subway/accuracy`.

## Decision

### D1. Subway is its own top-level feature

`src/subway/` is a top-level module, not a sub-module of `src/bus/` and not part of a new transit module (owner, 2026-10-15, umbrella issue 65). `src/calendar/` is top-level because bus and subway both read it.

### D2. The train map is a guest source

The train map is an unofficial page with no robots.txt (404 on 2026-10-16). We crawl it at most once every 15 s, one request for every line, with a `User-Agent` naming skkuverse, and nothing may depend on it: when it fails or changes, the API and the timetable keep serving at lower accuracy.

### D3. The call budget is ours, not the upstream's

The Seoul real-time key has no daily limit since its gallery approval on 2026-10-16 (entry `cd82246baa4d1bb76d9b40bf064a3805`); the data.go.kr key allows 10,000 calls a day for 특일 정보 (15012690). The daily ceilings (`config.subway`) are runaway guards, kept as code constants rather than Doppler values, since a Doppler change needs a deploy too.

### D4. Every platform is polled all service day

Each served platform is observed for its whole service window. Rejected by the owner (2026-10-18): a per-station or commute-hours window, though it is the obvious way to cut the weekday API calls.

### D5. Rules, not calibration

Estimates are rules over observed events and the timetable (owner, 2026-10-18). No fitted offset, clamp or statistical correction ships until the accuracy report shows it is needed; a line's published countdown is served `live` even where it is known to run early (line `2`). Rejected: a fixed time per remaining station, which ignores each train's own timetable row.

### D6. Fix a lost train by coverage, not by a new rule

When the tracker loses a train between stations, track every station between and ahead of the served platform instead of changing an estimate rule: positions stay one call per line and events stay at served platforms, so coverage adds no upstream call and no Atlas write. Rejected (2026-10-18, a 수인분당 train shown 10–16 min late): bounding standing time by `lastSeenAt`, a per-line "reports no departures" cap, and per-direction station sets in the route model.

### D7. 신분당 trainsets are matched to runs

Rejected: serving 신분당 from the timetable alone, which discards the freshest positions of any line (median lag 6–8 s); an observed event plus the scheduled run time without matching, which lists a train twice unless it grows its own de-duplication and loses lent delays; a trainset-to-run roster, which does not exist.

### D8. The day type comes from the calendar alone

A service day's table is weekday, Saturday or holiday by the calendar (owner, 2026-10-16), though operators sometimes run another table on a substitute holiday (Seoul Metro ran its weekday table on 2021-08-16 and its holiday table on 2021-10-04 and 10-11). Rejected: inferring the table from live trains; fetching timetables from the KRIC API at runtime, which needs another key and turns a yearly change into a runtime dependency.

### D9. Public holidays come from the official calendar, never edited by hand

`src/calendar/` mirrors 한국천문연구원 특일 정보 (`getRestDeInfo`); the owner ruled out manual updates (2026-10-16). Rejected: packaged calendars (`@hyunbinseo/holidays-kr`, `@kyungseopk1m/holidays-kr`), which need a bump and a deploy for each new holiday, and `date-holidays` alone, which misses temporary holidays and election days. Every calendar holiday is a no-service day for a holiday-respecting service: the owner confirmed that the 인자셔틀 and the commute shuttle do not run on substitute, temporary or election-day holidays.

### D10. A line marker's color is for the light background

`marker.color` is chosen for the app's white row; in dark mode the app adapts that one color. No dark-mode color is served: one color cannot serve both modes, and the bus badges need the same adaptation.

## Consequences

- Each source fails alone: the API, the train map and the calendar each degrade to the next source, never to an error.
- The train map can change or block us without notice; its fixture specs catch a format change only at the next deploy.
- A substitute holiday run on another table serves the wrong table that day, undetected.
- Line `2`'s long-lead countdowns stay 1–3.5 min early until the report justifies a correction.
