---
title: Academic Calendar
type: adr
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-10-23
audience: internal
---

# 0021. Academic Calendar

> Where the server learns whether a date is in a semester or a vacation, and which dates are SKKU school rest days, and why every date question now goes through one module, `src/calendar/`. Read it before you change how a feature asks about a date, the default semester rule, or what the server reads from `academic_calendars`. Accepted 2026-10-23; the module is described in [calendar-architecture.md](../explanation/calendar-architecture.md).

## Status

Accepted 2026-10-23.

## Context

- The HSSC shuttle runs 07:00 to 23:00 on weekdays in a semester and 07:00 to 19:00 in a vacation, and nothing in the server knew which dates are which.
- SKKU publishes each academic year's calendar (`학사일정`) on `ca_de_schedule.do`, a year running from March 1 to the last day of February. skkuverse-crawler crawls it daily at 05:35 KST (module `academic-calendar`, `spencer0124/skkuverse-crawler#84`, its adr-013) into `academic_calendars` in its base database, which this server already reads as `MONGO_NOTICES_DB_NAME`. Each document holds the year's two semesters, its rest days and every raw entry, keyed by the year.
- The date answers were spread out: the holidays module answered public holidays, the `skku-rest-days` dataset ([ADR 0013](0013-runtime-data-in-mongodb.md)) was read inside the bus schedule content, and a third source would have been a third door.
- The crawler is not deployed yet, so production holds no `academic_calendars` document. A year can also go unpublished past March 1, or a page can change shape.

## Decision

### D1. One module answers every date question

`src/calendar/`, renamed from the holidays module, is the one door: `CalendarService.current()` hands out a snapshot built from one read of the rest days and the crawled years, whose `dayOf(date)` answers a KST date's public holiday, school rest day and academic period together, and whose `revisionKey` changes whenever a `dayOf` answer other than a public holiday may change (the rest days' revision and each crawled year's `contentHash`), so a cache built from one snapshot's days keys on it and never mixes two revisions. `publicHolidayName(date)` stays as the cheap call that reads only the public holidays. The `skku-rest-days` dataset moved from the bus schedule content (`src/bus/schedule-content/`) to this module unchanged: same id, same stored shape, same push checks. The public-holiday sync moved along as `holiday-sync/`, registered only by the app module, with its poller name and log events unchanged. Rejected: an `academic/` and a `rest-days/` sub-module beside a root door, because a parent never imports its children ([ADR 0010, D3](0010-server-architecture.md)); the read side is the root, with one repository for its three reads.

### D2. The crawler crawls, the server reads

The server reads `academic_calendars` and never writes it; the crawler owns its shape (`AcademicYearDoc` in `skkuverse-crawler/py/src/skkuverse_crawler/modules/schedule/models.py`). The read projects the fields it uses, parses each document with zod and leaves out a document that fails (a semester pair not term 1 then term 2 in order inside its year, an `_id` other than its year, a date that is no calendar date), logging `academic_calendar.invalid_document`; that year is then answered by the rule, never an error to a rider. The read is cached like the public holidays: ten minutes, kept a day through failed reloads. A read that fails with nothing good to serve answers no crawled year, so the rule answers every year and the schedule keeps serving: logged as `academic_calendar.read_failed`, retried once a minute. The crawler owns the Slack alerts for a stale, missing or broken year (its coverage records); the server adds none.

### D3. The default rule

A year no valid crawled document covers is answered by a rule, logged as `academic_calendar.rule_fallback` at most once an hour per academic year:

- term 1 starts on 03-02 when that is a weekday, and otherwise on the first weekday after it that is not a public holiday;
- term 2 starts on the Monday nearest 09-01;
- each term ends on the last weekday before its start plus sixteen weeks;
- every other day of the academic year is vacation.

It reproduces all six boundaries SKKU published for 2024 to 2026. Rejected: "the first weekday on or after 03-02 that is not a public holiday", the rule first proposed: 2026 opened on 03-02, a substitute holiday for 03-01, so that rule answers 2026-03-03 and ends term 1 a weekday late, while 2025 skipped its substitute holiday 03-03. Two years cannot tell why; the rule keeps both until a crawled year says otherwise. The public holidays the rule consults are the calendar's own: the stored year, or the rule-based calendar.

### D4. The dataset overrides the crawl

A date's school rest day is the `skku-rest-days` label when the dataset names it (exact or yearly), and otherwise the crawled row's title less a class-day count in parentheses (2025's `공부자탄강일(수업일수 1/4)`); `dayOf` says which source answered. An operator corrects or adds a rest day with `npm run data` with no crawler change, and the dataset's labels already shown to riders do not change when the crawl lands.

A no-service day's label ranks three sources: the dataset's rest day, then the public holiday's name, then the crawled rest day (`toNonOperatingDayLabel`). A crawled rest day ranks below a public holiday because SKKU's calendar names its own observance where the official calendar names the day riders know: 2026-09-25 is both 건학기념일 in the crawl and 추석, and the shuttle shows 추석. The dataset still outranks a public holiday, as it did before the crawl (an operator's label is a deliberate choice).

## Consequences

- Until the crawler is deployed every year is answered by the rule, and `academic_calendar.rule_fallback` is logged hourly per academic year asked for.
- Once a crawled year is stored, its rest days the dataset does not name become no-service days on the shuttles that respect holidays, and its `contentHash` joins the schedule's week cache key.
- The academic period has no consumer yet; the HSSC service hours are the next.
- The crawler's `academic-calendar` watch check compares the dataset's rest days with this server's API; it can retire once the crawled rest days are served (crawler adr-013, "Revisit when").
- **Open:** whether a rest day inside a semester should count as a semester day for service hours; the period answers the semester today.

## Related

- [ADR 0013](0013-runtime-data-in-mongodb.md): the `skku-rest-days` dataset and its read contract
- [ADR 0017, D9](0017-subway-arrivals.md): why the public holidays come from the official calendar
- [Calendar architecture](../explanation/calendar-architecture.md): the module
