---
title: 2026-10 Subway Late Express Drop-Out Postmortem
type: explanation
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-10-27
audience: internal
---

# 2026-10-17 Subway Late Express Drop-Out Postmortem

> A Sinchang-bound express ran 12.5 minutes late through Sungkyunkwan Univ. and vanished from the down list for ten minutes, so the list disagreed with Naver and Kakao Map. This records why the tracker lost it and what changed. The current behavior lives in [subway-architecture.md](subway-architecture.md); this file is history.

| Item | Value |
| --- | --- |
| Date | 2026-10-17 (Saturday, holiday timetable) |
| Status | Fixed in `176bba28`; the app does not render subway arrivals yet, so no user saw it |
| Detection | The owner compared the station's down list (toward Hwaseo) with Naver and Kakao Map |
| Trigger | Express `1935` (to Sinchang) running about 12.5 min behind its timetable |
| Root cause | A down express passes every upstream station we observed, so a late one had no event until it approached the served station, and the estimate dropped an unseen train at its scheduled departure |

## TL;DR

`1935` was scheduled at Sungkyunkwan Univ. at 16:27:00 and arrived at 16:39:43. Neither the Seoul API nor the train map reported it before 16:38:53, when it approached the station. With no history the tracker lent it the delay of the train ahead (about 60 s) and treated it as gone at 16:29, so from 16:29 to 16:38:53 the down list showed the following locals instead. The fix observes Geumjeong, the stop every down express makes before the station, holds a missing train's history across that run, and keeps an overdue train nobody has seen at the station listed instead of dropping it.

## Impact

- The down list of `KR-1-P153` lacked `1935` for about ten minutes, so its first trains and their stops away differed from Naver and Kakao Map.
- Its recorded predictions (`subway_predictions`) were 633 to 766 s early at the 10, 5, 3 and 1 minute horizons.
- `1933` the same afternoon was 240 s early at the 10 and 5 minute horizons, by the same mechanism; the train map happened to report its pass of Gunpo.
- No user impact: the app has no subway screen yet. No data was lost.

## Timeline

KST, from `subway_events` and `subway_predictions` in `bus_campus`.

| Time | Event |
| --- | --- |
| 16:18:30 | `1935` scheduled to leave Geumjeong (not observed then) |
| 16:23:00 | Local `0461` scheduled at the station; it arrived 16:24:08, about 60 s late |
| 16:27:00 | `1935` scheduled at the station |
| ~16:29 | The tracker drops `1935`: scheduled departure plus the 60 s lent from `0461` has passed |
| 16:29–16:38 | No event for `1935` from either source at Gunpo, Dangjeong or Uiwang |
| 16:38:53 | The Seoul API reports `1935` approaching the station; it is served again with `stopsAway: 0` |
| 16:39:43 | `1935` arrives |

## Root cause — 5 whys

1. **Why did the list drop it?** An unseen train was estimated from the timetable plus a delay lent by the train ahead, and dropped once that estimate's departure passed (`hasLeft` without a history).
2. **Why was it unseen?** The observed stations were the served station and three upstream on each side. Down, those are Uiwang, Dangjeong and Gunpo, and every holiday down express passes all three.
3. **Why do passes not show up?** The Seoul API reports a train only at stations it stops at. The train map reports some passes (it did for `1925`, `1929` and `1933`) but missed `1935` entirely.
4. **Why only the down direction?** Up expresses stop at Suwon, which is an upstream station of the up direction, so a late one is seen there. The down express's previous stop, Geumjeong, sat outside the covered stations.
5. **Why did the estimate assume the train had gone?** It had no way to tell "late and unseen" from "gone". The data says late: every one of the 157 trains scheduled at the station between 05:00 and 16:35 that day was reported at the station itself, so a train not yet seen there has not passed it.

## Resolution

All in `176bba28`; the module doc's Glossary and Invariants carry the rules.

| Change | What it does |
| --- | --- |
| Geumjeong (`KR-1-P149`) in the Korail timetables | `scripts/subway-timetable/convert.py` covers it and the two Korail tables were regenerated: every down express of the Gyeongbu sheets now starts its rows there (weekday `1945`, from the Seoul express sheet, has no Geumjeong row) |
| Watched stations (`watchedStationIds`) | A station the tracker observes beyond the upstream ones; Geumjeong for the station's down direction. It joins the Seoul name table only: it is never a previous station and gives no stops away, so what the app renders is unchanged, and it costs no upstream call |
| Longer hold before the station | A missing train not yet at the station keeps its history 15 min instead of 90 s (`MISSING_TRAIN_HOLD_MS`); the longest scheduled run between two row stops is 510 s, Geumjeong to the station by express. A train seen at or past the station keeps the 47 min hold, so it is never awaited again |
| Awaited train (`isAwaitedTrain`) | On the tracker's path only, an overdue train with a row stop before the station and nothing seen of it at or past the station stays listed at now plus its scheduled run from its first row stop. It goes once its departure plus `MAX_DELAY_SEC` passes, or once a later train of the same kind (express or local) is seen at or past the station; a local can overtake a late express on the four-track section, so kinds are not compared across. The timetable-only document is unchanged |
| Pass on the run into the station | Found by an existing test while adding Geumjeong: a pass of Uiwang by `1913`, whose first row stop became Geumjeong, read as its departure from Geumjeong and served it 5.5 min late. A pass on a train's run into its stop at the served station now stays its progress, timed from its passing stop |

Replayed on 2026-10-17's events, `1935` is served at its schedule until 16:29:00, then at now plus its 8.5 min Geumjeong run (16:37:31 at 16:29:01), and at its observed arrival from 16:38:53. With Geumjeong observed it would have been seen there first.

## What went well / what went wrong

- Went well: `subway_events` and `subway_predictions` held enough to rebuild the minute-by-minute picture after the fact, and the per-horizon errors showed the size of the miss at once.
- Went well: an existing pinned train (`1913`) caught the side effect of adding a station before it shipped.
- Went wrong: the upstream list did two jobs, what the app shows and what the tracker observes, so it was sized for the screen (three stations) and missed the express stop pattern, which differs by direction.
- Went wrong: a known follow-up already described the drop-out (express `1921` earlier the same day, about a minute); it looked small until a long delay hit it.

## Action items

- [ ] Deploy, then check in `subway_events` that the Seoul API and the train map report down expresses at Geumjeong.
- [ ] Check `KR-1-P149` against the KRIC station code list file; it was taken from the passenger station number, which matches the neighbors' codes.
- [ ] In the accuracy report after deploy, compare the down express errors at the 10 and 5 minute horizons with this day's.
- [ ] Watch for a train served "now plus its run" with no position for long: a train missing from both sources for over 15 min before the station stays awaited until a later same-kind train or the 45 min bound clears it.
