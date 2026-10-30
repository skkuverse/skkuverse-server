---
title: Calendar Architecture
type: explanation
status: draft
owner: spencer0124
last-updated: 2026-10-24
audience: internal
---

# Calendar Architecture

> What `src/calendar/` reads of the official special-day calendar, how it reads SKKU's school rest days and academic calendars, how a date is answered, and what happens when a source fails. Read it before changing how any feature decides a public holiday, a school rest day, a semester or a vacation.

## Context

Calendar owns the date questions every feature asks ([ADR 0021](../decisions/0021-academic-calendar.md)): which dates are Korean public holidays (the shuttle schedules and the subway timetables), which are SKKU school rest days (the shuttle schedules) and whether a date is in a semester or a vacation (no reader yet), answered together by the `dayOf` of one `CalendarService.current` snapshot. It reads the official calendar of the Korea Astronomy and Space Science Institute, which lists substitute holidays, temporary holidays and election days, from `public_holidays`, which skkuverse-crawler fills daily from data.go.kr, so a holiday declared later reaches every replica with no deploy. School rest days are the `skku-rest-days` dataset ([ADR 0013](../decisions/0013-runtime-data-in-mongodb.md)), which only `npm run data` writes, over the rest days of the crawled years. Semesters come from `academic_calendars`, which skkuverse-crawler writes and this module only reads, and from the default rule for a year it does not cover. It serves no route and writes nothing: `CalendarModule` is the door other features import for `CalendarService`.

| System | Quirk tag | Gives | Enters at |
| --- | --- | --- | --- |
| skkuverse-crawler (`public-holidays`, from data.go.kr `getRestDeInfo`) | — | `public_holidays` in `MONGO_DB_NAME_BUS_CAMPUS`: the stored years, one `PublicHolidayYearDoc` per year keyed by the year as an int (the crawler's `docs/decisions/adr-013-academic-calendar.md`, its public-holiday amendment) | `CalendarRepository.listPublicHolidayYears` |
| The rule-based calendar (`date-holidays`, `KR`) | — | An answer for a year with no stored document | `lookupKoreanPublicHoliday` in `src/shared/korean-public-holiday.util.ts` |
| `npm run data` | — | The `skku-rest-days` dataset of the content database's `datasets`, checked at push against the schema ([edit-runtime-data.md](../how-to/edit-runtime-data.md)) | `CalendarRepository.findRestDays` |
| skkuverse-crawler (`academic-calendar`) | `skku` | `academic_calendars` in the crawler's base database (`config.notices.dbName`): one document per academic year with its two semesters, its rest days and its `contentHash` | `CalendarRepository.listAcademicYears` |

The data.go.kr gateway refuses a request whose header value holds `environment=` with HTTP `400` `INVALID_REQUEST_PARAMETER_ERROR`, before it checks the key. Sentry's `baggage` header holds `sentry-environment=<environment>`, so `sentryOptions()` (`src/infra/sentry-options.ts`) sets `tracePropagationTargets: []` and no outgoing call carries `baggage` or `sentry-trace`. When the server still synced the holidays, that header refused every production sync, `public_holidays` stayed empty and every date came from the rules fallback (`holidays.lookup.rules_fallback`). The bus clients call data.go.kr hosts too, so the setting stays; `__tests__/nest/infra/sentry.test.ts` checks the headers an outgoing call carries.

## Glossary

| Term | Means | Derived from | Not |
| --- | --- | --- | --- |
| public holiday (`PublicHoliday`) | A KST date the calendar lists with `isHoliday` `Y`, and its name as the calendar spells it | skkuverse-crawler, from `locdate` and `dateName` | — |
| stored year | One year's public holidays and the `fetchedAt` of the crawler run that wrote them, a `PublicHolidaysDoc` keyed by the year, parsed by `publicHolidaysDoc` | `CalendarRepository.listPublicHolidayYears` | `holidayCache` |
| holiday name | The name of the public holiday on a date, or null | `CalendarService.publicHolidayName` | — |
| rules fallback | The answer for a year with no stored year, from the rule-based calendar | `lookupKoreanPublicHoliday` | — |
| school rest day (`SchoolRestDay`) | An SKKU day off, its label and its source: the `skku-rest-days` label (`MM-DD` yearly or `YYYY-MM-DD` once, an exact date first), else the crawled year's title on that date less its class-day count | `lookupRestDay`, `toSchoolRestDayLabel` | `restDay` |
| academic year | A year from `ACADEMIC_YEAR_FIRST_DAY` to the last day of February, named by the year it starts in | `toAcademicYear` | `schoolYear` |
| crawled year | A valid `academic_calendars` document, an `AcademicCalendarDoc` keyed by its academic year | `CalendarRepository.listAcademicYears` | — |
| semester (`Semester`) | One of a year's two terms, `term` `1` or `2`, from its `start` to its `end` day, both included | a crawled year's `semesters`, or `toRuleSemesters` | — |
| vacation | A day of an academic year in neither semester | `toAcademicPeriod` | — |
| academic period (`AcademicPeriod`) | Whether a date is a semester or a vacation day, its term, and whether a crawled year or the rule answered it | `toAcademicPeriod` | — |
| rule fallback | The semesters of a year no crawled year covers, from the default rule ([ADR 0021, D3](../decisions/0021-academic-calendar.md)) | `toRuleSemesters` | — |
| calendar day (`CalendarDay`) | A date's public holiday, school rest day and academic period | `dayOf` of a calendar snapshot | — |
| calendar snapshot (`CalendarSnapshot`) | One read of the rest days and the crawled years, which answers every day a caller asks under one revision key | `CalendarService.current` | — |
| revision key | A string that changes whenever a calendar day may change but a public holiday, for a cache built from calendar days | `revisionKey` of a calendar snapshot | — |

## Structure

```mermaid
flowchart LR
  kasi["skkuverse-crawler public-holidays<br/>(data.go.kr getRestDeInfo)"] -->|daily| coll[("public_holidays")]
  coll -->|CalendarRepository.listPublicHolidayYears, cached| svc["CalendarService.publicHolidayName"]
  rules["date-holidays"] -->|year not stored| svc
  restDays[("content: skku-rest-days")] -->|CalendarRepository.findRestDays| day["CalendarService.current: dayOf, revisionKey"]
  crawler["skkuverse-crawler"] -->|daily| academic[("academic_calendars")]
  academic -->|CalendarRepository.listAcademicYears, cached| day
  rule["toRuleSemesters"] -->|year not crawled| day
  svc --> day
  day --> bus["bus schedule"]
  svc --> subway["subway timetables"]
```

## Invariants

- The server never writes `public_holidays`. skkuverse-crawler writes it once a day and alerts when a date a month out lies in no stored year; a year it has not published yet is never stored, so it keeps its rules-fallback answer.
- `CalendarRepository.listPublicHolidayYears` reads the stored years through `createCachedLoader` for `STORED_YEARS_TTL_MS` (ten minutes, so a stored holiday reaches every replica within ten minutes, [runtime roles](../decisions/0012-runtime-roles.md)), waits for the reload once that passes, and keeps the last good years for `STORED_YEARS_STALE_WINDOW_MS` only when a reload fails. It projects the three fields it uses and parses each year with `publicHolidaysDoc`: one that fails (an `_id` that is no integer, a date that is no calendar date) is left out and logged as `calendar.public_holidays.invalid_document`, so its dates are answered by the rules fallback.
- A stored year is answered from the calendar alone; the rules fallback answers only a year with no stored year, and logs `holidays.lookup.rules_fallback` once an hour per year.
- A date outside the years `lookupKoreanPublicHoliday` takes throws a `RangeError` (`toHolidayYear`) before any answer, a calendar day included, even on a school rest day.
- The school rest days are read as every dataset is ([ADR 0013, D6](../decisions/0013-runtime-data-in-mongodb.md)): through `createDatasetLoader`, a push serves within `DATASET_CACHE_TTL_MS`, a failed or invalid reload keeps the last good revision, and with none ever read `current` answers `CalendarUnavailableError` (`503 CALENDAR_UNAVAILABLE`), which a feature answering riders maps to its own. `publicHolidayName` reads no dataset, so it answers without them.
- `CalendarRepository.listAcademicYears` reads `academic_calendars` with the stored years' TTL and stale window, projects only the fields it uses and parses each document with `academicCalendarDoc`: one that fails (its `_id` not its year, its semesters not `isSemesterPair`, a date that is no calendar date) is left out and logged as `academic_calendar.invalid_document`, so its year is answered by the rule, never an error ([ADR 0021, D2](../decisions/0021-academic-calendar.md)). A read that fails with no good value inside the stale window answers no crawled year, so the rule answers every year, logs `academic_calendar.read_failed` and is retried once `ACADEMIC_READ_RETRY_MS` passes, never once a request. The server never writes the collection, and adds no alert: the crawler alerts on a missing or broken year.
- A crawled year answers its academic period alone; the rule fallback answers a year with none, over the public holidays the calendar itself answers, and logs `academic_calendar.rule_fallback` once an hour per academic year (`RULE_FALLBACK_LOG_INTERVAL_MS`).
- The dataset's rest day wins over the crawled one on the same date, and a calendar day says which answered, so a reader can rank a public holiday between them: the shuttle label ranks the dataset, then the public holiday, then the crawl ([ADR 0021, D4](../decisions/0021-academic-calendar.md)).
- A snapshot's `revisionKey` joins the rest days' revision and each crawled year's `contentHash`, in year order, so it changes with either and with a year added, and its `dayOf` answers every date from that same read, so a cache built from one snapshot never mixes two revisions.
- Other features import only `CalendarModule` and `CalendarService` ([ADR 0010, D1](../decisions/0010-server-architecture.md)).

## Open questions

- Whether a school rest day inside a semester counts as a semester day for the HSSC service hours, the period's first reader; `dayOf` answers it as a semester day today.

## Related

- [ADR 0021](../decisions/0021-academic-calendar.md): one calendar module, the crawled academic calendars and the default rule
- [ADR 0017, D9](../decisions/0017-subway-arrivals.md): why the official calendar, never edited by hand
- [Bus architecture](bus-architecture.md): the shuttle schedules that read the calendar day
- [ADR 0010](../decisions/0010-server-architecture.md): the module shape
- [Docs index](../README.md): writing rules
