---
title: HSSC Arrival Estimates — What We Measured and Rely On
type: adr
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-10-27
audience: internal
---

# 0018. HSSC Arrival Estimates — What We Measured and Rely On

> The measured behavior of the HSSC shuttle feed that the HSSC ETA engine (`src/bus/realtime/hssc-eta/`) and the HSSC poller are built on, the route line and stop locations measured from its GPS, the route line redrawn on NAVER's roads, and the choices that follow from them. Read it before you change how a bus is anchored, the dwell and travel table, how the layover is treated, which feed row a bus is anchored on, the HSSC route line on the map or where an HSSC stop's coordinates come from. Accepted 2026-10-22, D7 and D8 added 2026-10-23, D9 and D10 later that day, D11 that evening; the rules are in [bus architecture](../explanation/bus-architecture.md), the wire in [bus-live-api.md](../reference/bus-live-api.md).

## Context

- The owner compared the public HSSC feed with the shuttles' GPS on 2026-10-20 and measured a second day on 2026-10-22: about 100 laps over the two days.
- The live route ([ADR 0019](0019-bus-live-api.md)) serves the engine since 2026-10-22.
- On 2026-10-23 a replay of 35 h of feed (2026-10-20 08:20–23:10, 10-22 07:00–23:00, 10-23 06:15–10:28; 20.8 h of it with shuttle GPS fixes, collected privately) measured how often the live route takes a bus back and compared fixes; it led to D7 and D8.

The tables below are what the decisions rest on. Each names its measurement.

### The public feed

| Behavior | Measured | Source |
| --- | --- | --- |
| `ENTERED` is the arrival | Median −3 s against GPS (p10 −12 s, p90 +6 s) | 2026-10-20 field audit, §3 |
| `LEFT` is the departure | Median +6 s against GPS (p10 −9 s, p90 +141 s) | Field audit, §3 |
| `ENTERED` is often missing | 110 of 616 visits (18%) had `LEFT` only, mostly at the quick passes (seq 1, 10, 2, 9, 6); `LEFT` is nearly always there | Field audit, §3 |
| `LEFT_LAST` | Only at seq 10, which never sends `LEFT`: the lap's last position | Field audit, §3 |
| `EMERGENCY` | A near-stop flag, within ±6 s of a physical stop (median 0), 35 a day, mostly at 성균관대입구사거리 (seq 2) and the rotary (seq 10); never a pass | Field audit, §3 |
| `stop_no` | Differs per line for one stop (농구장 is 284258, 285687, 285698 and 285720), so only `seq` is an identity ([ADR 0019](0019-bus-live-api.md), D5) | Field audit, §2.1 |
| Ghost lines | `32151` and `32153` are in every answer, their `get_date` frozen at 2026-05-22 and 2025-02-14 | Field audit, §8 |
| `get_date` | The event's instant, within ±3 s of the GPS clock, with no offset between the feeds; but the row repeats until the next stop event, so between events it is stale: median 70–95 s with GPS live, p90 8–12 min on the outer loop, and before a bus's first stop of the day it is the previous night's last event | Field audit, §5 and §7 |
| The rotary is two positions | Seq 1 (on the way up) and seq 10 (on the way down) are the same 혜화동로터리, about 31 m apart, where the shuttle boards no one. After 혜화역 → seq 1 the feed reports seq 10 on about 27% of passes (36 in the 35 h) | 2026-10-20 GPS; the 2026-10-23 replay |
| The turnaround's `LEFT` | Fires about 70 m past 농구장, while a bus that keeps laying over parks about 80 m past it, just outside that circle. From `LEFT` to the next stop event the delay is bimodal: 83% within 71 s (median 34 s), the rest at 117 s or more (median 591 s), none between | The 2026-10-23 replay |
| A bus out of service | Looks like a long layover: on 2026-10-23 32150 left 농구장, parked about 900 m away near 혜화역 and its GPS fell silent after 08:21, while the feed kept its `LEFT` | Shuttle GPS fixes (collected privately), 2026-10-23 |
| Service hours | Not published, so the line is `noData` at night rather than `ended` (ADR 0019, D8) | — |

### The route

| Shape | Measured | Source |
| --- | --- | --- |
| A lollipop | The campus spine 정문 ↔ 농구장 is driven both ways, the outer loop one way: 성균관대입구사거리 on the way up, 올림픽기념국민생활관 and 혜화동우체국 (drop-off only) on the way down | 2026-10-20 GPS |
| Paired stops | 정문 등교 and 하교 dwell points are 4.5 m apart with opposite headings; 600주년기념관 등교 and 하교 are 15 m apart on opposite curbs, 등교 about 5 m from `hssc-600th` | 2026-10-20 GPS |

### Timing

| Segment | Measured | Source |
| --- | --- | --- |
| The layover at 농구장 | Median 674 s, p90 846 s (D2) | 2026-10-20 and 10-22 |
| Feed dwell against GPS | 혜화역 about 174 s in the feed against 90 s on GPS, 성균관대입구사거리 about 63 s against 18 s; it does not matter to arrival-to-arrival estimates (D3) | Field audit, §3; D3's table |
| Day to day | The per-seq medians of D2 and D3 agree within about 5 s a segment | 2026-10-20 and 10-22 |

### Shuttle GPS (collected privately, never served)

The shuttles' GPS fixes and the operator's stop points were collected privately; this repository neither reads nor serves them, and the detailed measurements stay with them. The fixes checked the feed's timings above, and measured the route line (D9) and the stop locations (D10). What the server relies on from them:

- **The route line.** 64 clean laps over 2026-10-20, 10-22 and 10-23 give a closed loop of 3,692 m, a point every 16 m (min 13), each moving fix a median 2.6 m from it; the same derivation per vehicle and per day agrees within a few metres. The campus spine is driven both ways as two passes about 2 m apart, the turnaround's layover stands 25–75 m past 농구장, and the line crosses itself at 정문 and at 혜화동로터리.
- **The stop locations.** The operator's stop list has points for seq 0 and 2 to 7, none for 올림픽기념국민생활관 (seq 8), 혜화동우체국 (seq 9) or the rotary (seq 1 and 10). Each was checked against where buses stand; D10 records the outcome per stop.
- **The line on NAVER's roads.** NAVER's road runs up to about 12 m from the lane the buses drive, NAVER will not route the 올림픽기념국민생활관 rotary's south exit, and its paths meet at sharp corners. The drawn line of D11 stays within 7.3 m of a moving fix everywhere, leaves no stretch more than 10 m from all of them, and passes every stop within 13.5 m on its own pass.

The tables do not restate the wire: [bus-live-api.md](../reference/bus-live-api.md) does.

## Decision

### D1. A bus is anchored on the feed's stop events

Against GPS, `ENTERED` is the real arrival (median −3 s) and `LEFT` the real departure (median +6 s). `LEFT` is nearly always present, while `ENTERED` is missing on 18% of visits. `EMERGENCY` means "near this stop", not a pass. So a departure event anchors a departed bus at its own instant, and any other event anchors a bus at the stop from its first sighting there.

### D2. No time crosses the 농구장 layover

The turnaround's `ENTERED` → `LEFT` is a real layover: median 674 s, p90 846 s over the two days, and its end cannot be predicted. A bus whose path crosses it is `waitingToDepart` with no instant.

### D3. The table is per-seq medians of the feed's events

`SEGMENTS_BY_SEQ` holds, per API seq, the median dwell (`ENTERED` → `LEFT`) and travel (`LEFT` → the next stop's `ENTERED`) of 2026-10-20 (Tue) and 2026-10-22 (Thu). The two days agree within about 5 s a segment, and for every hop the departure-to-departure median is about the travel plus the next dwell, which checks the table despite the missing `ENTERED`s. The feed's dwell at 혜화역 (seq 0) and 성균관대입구사거리 (seq 2) is longer than GPS shows, and is kept on purpose: arrival to arrival is what a rider waits. Between events the feed goes stale on the outer loop (p90 8–12 min), so an overdue part counts 0 and an instant never falls in the past, until the bound of D6.

### D4. The engine serves instants, never text or minutes

Rounding to minutes and wording such as 곧 도착 belong to the API and the client.

### D5. No uncertainty window yet

Rejected: summing per-segment p10s and p90s. A lap's segments are correlated (a late bus stays late) and the layover dominates the spread, so the sum misstates the window. An honest window is the backtested error by horizon against GPS arrivals.

### D6. An overdue estimate stops at a bound instead of sliding with the clock

Counting the overdue part as 0 (D3) keeps a departed bus "arriving now" for as long as its next stop event is late, so on 2026-10-23 (08:13–08:27) bus 32150, its feed stuck on `LEFT` at 농구장, was due at 600주년(하교) at `serverNow` on every poll and the client's two-minute overdue rule (ADR 0019, D10) never fired. So a departed bus is overdue once its next stop event is later than the travel median plus a bound, measured from `hssc_feed_events` and the privately collected GPS fixes over 2026-10-22 07:00 to 10-23 08:30 (about 60 laps), each gap timed to when the poller saw the next event:

- After the turnaround the travel to seq 6 is bimodal. Of 58 departures, 44 showed the next event within 50 s past the 21 s median and 14 at 96 s or more (up to 53 min), none between. GPS labels the two on 2026-10-23: the bus parked 45–60 m from the stop for 14 and 29 minutes after `LEFT`, the layover going on off the stop's geofence. The third, 32150 that morning, drove off the route to a spot near 혜화역 and its GPS stopped. The bound there was 60 s, past which the bus was laying over again; D7 replaced it on 2026-10-23, as it took a bus back about 10 times a day.
- Elsewhere, 614 of 625 departures showed the next event within 120 s past the median; the 11 beyond reached 143–201 s (4, slow traffic) or 282 s to 47 min (7: stalls and feed gaps). The bound is 120 s, the time the client keeps 곧 도착 for an overdue arrival, and past it the bus is `unknown` at every stop, with no instant and no lap times, its position kept as last seen. A client tells "arriving now" from "no idea".
- A bus at a stop is never overdue: its long dwells (up to 516 s at 혜화역 in the window, GPS showing it standing there on 2026-10-23) are true, and the instants downstream already start at now plus the travel.

Before the bound nothing changes. A stalled bus is listed after every other bus at a stop, so it never takes one of the two served slots (ADR 0019, D9) from a bus a client shows.

### D7. A departure from the turnaround waits for the next stop

A `LEFT` at 농구장 (seq 5) means the bus left a circle about 70 m around the stop, not that it started its lap: a bus that keeps laying over parks about 80 m past the stop, and the delay to the next stop event is bimodal (83% within 71 s, the rest 117 s or more, none between; Context). So the engine does not count it as a departure: the bus is at the turnaround, laying over, until the feed reports seq 6 or any later stop of the lap. Its position is `waitingToDepart` with no trajectory and no next-station instant, and it is `waitingToDepart` at every stop, first at 농구장 and its stops away counted from there. The 60 s bound of D6 is gone; the 120 s bound elsewhere stays, and the live route's 15-minute layover window (ADR 0019, D8) still drops a bus that stands longer.

Replayed over the 35 h: no marker glides back, no parked bus is shown as departed (the bound showed 16 of 17 parked buses departing), and the ETA error's p90 is 72, 112 and 142 s for the first, second and third stop ahead, against 84, 115 and 157 s with the bound. The cost is that a real departure starts moving about 20 s later (median 39.5 s after it instead of 20 s, p90 54.5 s), and 600주년기념관 (하교), 21 s away, gets no instant before the bus reaches it.

Rejected: a shorter bound (any bound takes back the buses parked past it) and confirming the departure from GPS, which would start a real departure about 11 s sooner (the replay's GPS variant) but depends on a feed this repository does not read; the GPS stays collected only.

### D8. A feed row that puts a bus back in its lap is held off

After 혜화역 → seq 1 the feed reports seq 10, the same rotary, on about 27% of passes: the engine then served the bus two stations back and assumed another 혜화역 stop ahead of it, so 혜화역 showed about a minute for a bus that had just left it, about 16 times a day. A bus cannot drive backward, so the HSSC poller compares each feed row with the bus's previous anchor row: a row 1 to 5 positions back in the lap (`MAX_BACKWARD_POSITIONS`: half the 11-position loop, which tells a step back from a skip ahead) anywhere but the turnaround, where every lap ends, is held off while the previous row is fresh by the window that keeps a bus served (`STALE_MINUTES`, `LIVE_STALE_MINUTES_AT_TURNAROUND`); past it the feed's row anchors again. Seq 1 → seq 10 is the case it was built for, and a forward row (seq 10 → seq 0, seq 4 → seq 5) always anchors.

The poller needs memory across ticks, and only a polling role writes (ADR 0012), so it stores the held row in the bus's `bus_cache` entry beside the feed's row, and only when it holds one. The deprecated realtime route reads the feed's row alone, so its body stays byte for byte (ADR 0019, D11). During a deploy the new api replicas read an older poller's entries, which have no held row, as the feed's row.

Replayed with the compiled poller and live route every 10 s over the 35 h: the live route took a bus back 59 times before (22 at the turnaround, 36 from seq 1 to seq 10) and once after, and the deprecated route answered the same on every tick. The one left is a bus that left the lap: on 2026-10-23 32152 went from seq 1 straight to seq 7 and round to seq 0; held at seq 1 for the 10 minutes that row stayed fresh, it was then served leaving 혜화역, half a station back. The research replay hid such a bus once its held row went stale; the poller serves the feed's row instead, as a stale row would be.

### D9. The HSSC route line is a measured dataset

The map draws each Jongno route's line from TOPIS, synced daily (`src/bus/route-path/`). The HSSC shuttle has no upstream that draws its road: the operator's app has stop points and live GPS, no line, and the school publishes an image. So the line is derived from GPS, once, and stored as the `hssc-route-line` dataset (`{ path: [[lng, lat], …] }`, [ADR 0013](0013-runtime-data-in-mongodb.md)), which `GET /map/overlays/transit` serves as one more path overlay on its own opt-in layer, `hssc_route`, in the HSSC card's SKKU green (`003626`).

- **Derivation.** A principal curve fitted to every clean lap by the bus's progress, never by proximity: start from the shortest clean lap's fixes; place each moving fix on the curve by its distance along it, searching only between the stop index its fix reports and the next stop (±70 m), so the two passes of the spine, 2 m apart, never mix; drop fixes more than 25 m off; take the coordinate-wise median of the fixes within ±10 m of each 8 m bin; drop a point that folds the line back away from the turnaround; resample every 16 m; repeat six times. The checks are the Context's: the same derivation per vehicle and per day, segment lengths, every stop on its own pass, the spine's two passes and the loop closed.
- **Stored as driven.** `[lng, lat]` like a Jongno route path, closed (the last point repeats the first, unlike TOPIS's open loops) and starting at 농구장, the app's first station. A push is refused for a point off the globe's ranges (a swapped pair lands there), fewer than 10 points, an open loop or a segment over 100 m (`toRouteLineIssues`).
- **Its own dataset, not a field of `bus-stops`.** A different source and cadence (a measurement redone when the route changes, against a catalog edited by hand with every stop change), a different reader (the map, against the config, the pollers and the stop index), and a size (a few hundred points) the stop readers would parse on every reload for nothing; and a `bus-stops` push would have to carry it unchanged.
- **Degraded, never a 503 for the Jongno lines.** With no good line ever read, the transit overlay serves the Jongno lines alone with the minute's `Cache-Control` and the cause logged at error ([ADR 0013, D6](0013-runtime-data-in-mongodb.md)); a Jongno read failure still answers its own 503.

Rejected: a line through the stop points or a directions API asked stop to stop alone (the campus roads, the turnaround loop and the 혜화역 U-turn are not what a router draws unasked; D11 asks with via points); the 2026-10-20 line as it was (it backtracks on the spine); and the stations on the overlay (the Jongno lines serve none: a stop layer waits for the app change [map-overlays-api.md](../reference/map-overlays-api.md) describes).

### D10. An HSSC stop's coordinates are the operator's first, GPS where the operator has none or is clearly wrong

Owner decision, 2026-10-23: an HSSC stop's coordinates come from the operator's static stop list, not from GPS medians. GPS checks them: each operator's point must lie within 30 m of its stop's dwell cluster, no more than 2 m left of the line on its own pass and of the dwell heading, and nearer its own cluster than the same-name stop's of the other direction; a stop that fails is flagged for the owner, never moved by the check. Where the operator has no point, or the owner judges a flagged one clearly wrong, the stop takes its GPS dwell cluster.

The check of 2026-10-23 and the owner's choice the same day:

| Stop | Coordinates | Why |
| --- | --- | --- |
| `hssc-hyehwa-exit1`, `hssc-skku-junction`, `hssc-main-gate-in`, `hssc-600th-hall`, `hssc-main-gate-out` | operator | passed |
| `hssc-basketball-court` | operator, 37.58784866, 126.99238586 | flagged on its heading only, a false positive: the bus turns about 90° at the stop, and the line check passes |
| `hssc-student-center` | GPS, 37.587190, 126.993930 | The operator's `600주년기념관 앞-하교` sits nearer the 등교 cluster than its own, about 22 m up the road |
| `hssc-olympic-hall` | GPS, 37.589635, 126.999180 | no operator's point; the cluster passes through, few buses stand there |
| `hssc-hyehwa-post-office` | GPS, 37.585900, 127.000850 | no operator's point |

The coordinates are written to `bus-stops` by its owner, not by the change that measured them: production `bus-stops` revision 4 holds the five stops whose operator's points passed and revision 5 농구장 from the operator and 학생회관, 올림픽기념국민생활관 and 혜화동우체국 from GPS, each rounded to 7 decimals and checked on the stop pages on 2026-10-23. Revision 3 is the one before: `npm run data -- rollback bus-stops 3 --prod`.

### D11. The route line is drawn on NAVER's roads and checked against GPS

The owner, 2026-10-23, of revision 1 on NAVER Map: the roads are clear two-way carriageways, so the line should run straight along them, an intersection may be a clean circle, and what can be straight should be. NAVER Map is the app's map, and NAVER Directions returns the road geometry NAVER draws, so the line is NAVER's road between the stops, smoothed, and GPS only checks it (D9's measurement becomes the check, not the source). Of three candidates compared against the fixes, the one below:

- **NAVER's road, stop to stop.** Three Directions 5 driving calls (`traoptimal`), each at most five waypoints: 농구장 → the turnaround's west and south lanes → 학생회관; 학생회관 → 정문 (하교) → 성균관로 before the 올림픽기념국민생활관 rotary → the rotary's west entry → 혜화로 below it → 혜화동우체국 → 혜화역 1번출구; 혜화역 1번출구 → 성균관대입구사거리 → 정문 (등교) → 600주년기념관 → 농구장. The stops are the `bus-stops` coordinates; the via points are points of revision 1 where NAVER would otherwise take another road. The three paths join exactly at their shared stops.
- **One correction.** NAVER will not take the 올림픽 rotary's south exit (Context: every request through it U-turns in the rotary and comes back by 성균관로16길, 45 m off the bus), so its path is cut from the rotary's west entry straight to the 혜화로 junction its detour rejoins, as the fixes cross.
- **Smoothed, not moved.** Douglas–Peucker at 0.5 m; each corner of more than 12° becomes a circular arc of 10 m radius, shrunk until it uses at most half of either neighbouring segment, so 혜화동로터리 stays NAVER's ring and the U-turns become round; where one carriageway is driven both ways (580 m from 정문 to the turnaround, and 14 m at the rotary's 대학로 approach), each pass moves 1.25 m to its right, tapered over 12 m, so the two passes are 2.5 m apart on the correct side; points at most 16 m apart. The result is within 0.2 m of NAVER's path (median; p95 1.4, max 3.5 m, at a corner's apex).
- **Checked against GPS**: every point within 7.3 m of a moving fix and no stretch more than 10 m from all of them, so the line takes no road the bus does not; every stop within 13.5 m on its own pass; the spine's passes apart and on the right; the loop closed and starting at 농구장; no segment over 16 m. The scripts write these figures to `validation.json`.
- **Rolled out through `_dev` first.** Revision 2 of the `_dev` dataset holds it since 2026-10-23; production keeps revision 1 until the owner has compared the two on the preview. Revision 1 stays one rollback away: `npm run data -- rollback hssc-route-line 1 --prod`.

Rejected: A, NAVER's path as it comes (the spine's two passes lie on one another, 16 corners sharper than 60° where NAVER's links meet); B, revision 1 cleaned the same way with the rotary fitted to the circling fixes (the tightest fit to GPS and every stop within 8.7 m, but it is the bus's lane, up to about 10 m beside the road NAVER Map draws, which is the mismatch the owner saw); each corner's radius fitted to the fixes around it (57 of 62 corners chose the smallest radius tried, 5 m: the 7 m between NAVER's road and the lane swamps the corner's shape); and OSM map matching (OSM's road geometry is not NAVER's either).

## Consequences

- Two weekdays are measured; rush hours, exam weeks and vacations are not. A per-hour table or a window needs new measurements first, such as from `hssc_feed_events` with GPS labels.
- When the table is re-derived, amend D3 with the new dates and method, not the `EVIDENCE:` comment alone.
- A bus that really skips back in its lap (the 2026-10-23 32152 case) stays at its held row for up to 10 minutes. Telling such a bus from the rotary confusion needs more than one row, such as two forward events in a row; nothing does that yet.
- The replay scripts are not in the repository; a rerun against a new month of `hssc_feed_events` and the privately collected GPS is how D6 to D8 are rechecked. Nor are D9, D10 and D11's, which are kept with the GPS, D11's with the three cached NAVER answers.
- The route line is NAVER's roads checked against three weekdays of laps. A rerouted shuttle (roadworks, a new stop) shows as fixes off the line, and needs the GPS measured again, the via points checked and the line redrawn; a NAVER road change does not reach it until then.
- NAVER's road is up to about 10 m from the lane the bus drives, so the line on the map is not where a GPS marker draws the bus; nothing reads the line but the map.
- 농구장's layover spot, 25–75 m past the stop, is where a bus waits before leaving; whether riders board there or at the stop is not measured.
