---
title: Change a Shuttle Timetable
type: how-to
status: draft
owner: spencer0124
last-updated: 2026-11-06
audience: internal
---

# Change a Shuttle Timetable

> How to change what a timetabled shuttle (인자셔틀, 통학셔틀, fasttrack) serves on `/bus/schedule/data/:serviceId/smart`: a new semester's timetable, a day off or a special day, and a new timetabled service.

## Overview

A timetabled service's day comes from the first of these that applies (`src/bus/schedule/bus-schedule.rules.ts`):

1. A `bus_overrides` document for that service and date: `noService` (no runs) or `replace` (its own runs).
2. A public holiday, a SKKU rest day or a crawled academic-calendar rest day, only for a service with `respectsKoreanHolidays` ([calendar architecture](../explanation/calendar-architecture.md)).
3. A `bus_schedules` pattern whose `days` and `effectiveFrom`..`effectiveUntil` cover the date.
4. The service's `nonOperatingDayDisplay` from `SERVICE_CONFIG` (`src/bus/bus.constants.ts`): `hidden` (every service today) or `noService`.

Pick the step by what you need:

| You need | Do | Deploy |
| --- | --- | --- |
| A new semester's or pilot's runs | [Change the timetable](#change-the-timetable) | No |
| A day off that SKKU's calendar does not list | Add a SKKU rest day ([edit-runtime-data.md](edit-runtime-data.md#add-a-skku-rest-day)) | No |
| A day off that carries a notice, or a day with its own runs | [Write an override](#write-an-override) | No |
| A break of weeks | Suspend the service ([edit-runtime-data.md](edit-runtime-data.md#edit-a-shuttle-notice-or-suspension)) | No |
| A notice on every day | Edit `bus-service-notices` ([edit-runtime-data.md](edit-runtime-data.md#edit-a-shuttle-notice-or-suspension)) | No |
| A new service or group | [Add a timetabled service](#add-a-timetabled-service) | Yes |

Public holidays need no step: the server reads them from the official calendar. Every write below is served within `WEEK_CACHE_TTL_MS` (`src/bus/schedule/bus-schedule.service.ts`) by every api replica and the estimate pollers, with no restart.

## Prerequisites

- A `.env` with the MongoDB names in `config/env.dev.keys` (`npm run env:pull`, or written by hand).
- Every write targets the `_dev` database unless you pass `--prod`. Write `_dev` first and check the smart view of a local `npm run dev`.

## Steps

### Change the timetable

The committed timetable files are the only source of `bus_schedules`: `scripts/data/campus-schedule.json` (인자셔틀, the default) and `scripts/data/commute-schedule.json` (통학셔틀). Never write a pattern in `mongosh`: the database then disagrees with the repository and nothing reports it.

Each `npm run schedule` command in these steps names the file you edit with `--file <file>`. Without `--file`, the script reads `scripts/data/campus-schedule.json`, so a command without it never writes the 통학셔틀 timetable.

1. Edit the file. Each pattern has `patternId`, ISO `days` (1 is Monday), `serviceIds` and `entries`. The file's `effectiveFrom` and `effectiveUntil` bound every pattern, both days included. The header of `scripts/set-campus-schedule.js` lists every field and what the script refuses.

   If an entry's `stopTimes` changes length, the dry run in step 2 refuses the file against the stored `bus-stops`. Follow [Change a sequence's length](edit-bus-stops.md#change-a-sequences-length) for `_dev` and then production instead of steps 2 and 3: push `bus-stops` with `--against <file>`, then run the schedule command it prints. Continue at step 4.

2. Print the diff against `_dev`:

   ```bash
   npm run schedule -- --file <file> --dry-run
   ```

3. Write `_dev`, check the smart view, then write production:

   ```bash
   npm run schedule -- --file <file>
   npm run schedule -- --file <file> --prod
   ```

4. Commit the file, so the repository says what production serves. `npm run schedule -- --file <file> --check --prod` exits 1 while the two differ.

To start a new semester beside the current one, give the new file an `effectiveFrom` after the current `effectiveUntil`. The script refuses patterns of one service whose weekdays and date ranges overlap. A pattern the database does not have yet needs `--create`.

### Write an override

An override replaces one service's day. A `noService` override with `notices` also makes the smart view open on that day instead of skipping it (`isSelectable`), so riders read why. A `replace` override serves its own `entries`, in the timetable files' entry shape.

```json
{ "serviceId": "campus-inja", "date": "2026-12-24", "type": "noService", "label": "<shown on the day>", "notices": [{ "style": "info", "text": "<why>" }], "entries": [] }
```

1. Copy `scripts/seed-eskara-2026-noservice.js` to a new script named after the event, and set its dates, services, label and notice. Keep what makes it safe: `--dry-run` and `--prod` flags, `assertValidOverrides` before any write, and a `replaceOne` upsert on `{ serviceId, date }`, so a rerun writes the same documents.
2. Run it with `--dry-run`, then with no flag (`_dev`), then with `--prod`.
3. Commit the script, so the override is reviewable and can be rerun in another environment.

MongoDB refuses an override of any other shape (`scripts/lib/bus-overrides-validator.js`), but it accepts any string as `date`. Write each date as a KST calendar date in `YYYY-MM-DD`: the server looks up that exact string, so an override dated `2026-12-4` is never read. A past date is never read again, so an override needs no cleanup.

### Add a timetabled service

A new service is code and data. Write each change test first ([ADR 0011](../decisions/0011-test-strategy.md), D9).

1. Add the service id to `SERVICE_CONFIG` (`src/bus/bus.constants.ts`) with its `nonOperatingDayDisplay`. `respectsKoreanHolidays` and `eta` are opt-in: without them the service runs on holidays and gets no arrival estimates.
2. Add the group, or the service to an existing group, in `toBusGroups` (`src/bus/config/bus-config.mapper.ts`), and a new group's id to `FIXED_GROUP_IDS`. The array order is the app's list order. Each route type the timetable uses needs a `routeBadges` entry. A group shown only for a while takes a `dateRange` visibility (`src/bus/config/bus-config.config.ts`).
3. Add the label, service and badge strings to `src/infra/i18n.ts` (`busconfig.label.<groupId>`, `busconfig.service.<serviceId>`, `busconfig.badge.<routeType>`) in every supported language.
4. If the service serves stops, add it to `STOP_SERVICE_IDS_BY_GROUP_ID` and push its sequences in `bus-stops` ([edit-bus-stops.md](edit-bus-stops.md)).
5. For a new group, push a `transit-layout` that places it, from the checkout you deploy, before the deploy ([configure-home.md](configure-home.md#transit-layout)). `toBusGroups` does not place a group in the stored layout, and the transit tab leaves out every group the layout does not place.
6. Deploy, then write a new timetable file with the first load's `--create`:

   ```bash
   npm run schedule -- --file scripts/data/<name>-schedule.json --create --dry-run
   npm run schedule -- --file scripts/data/<name>-schedule.json --create --prod
   ```

## Troubleshooting

- **A day still shows the old runs.** An override or a rest day wins over a pattern: check `bus_overrides` for that service and date before you change the timetable file.
- **The smart view skips a closed day.** A `noService` day without notices is skipped. Give the override a notice.
- **A pattern is served from the wrong timetable.** Two patterns cover the date. The server serves the latest `effectiveFrom` and logs `bus.schedule.pattern_conflict`. Fix the ranges in the file and rerun `npm run schedule`.
- **A document is ignored.** A pattern or an override that does not parse is dropped and logged (`bus.schedule.invalid_document`); a dropped override is also a Sentry issue.

## Related

- [Bus architecture](../explanation/bus-architecture.md): the schedule, estimate and config flows and their invariants
- [edit-runtime-data.md](edit-runtime-data.md): rest days, notices and suspensions with `npm run data`
- [edit-bus-stops.md](edit-bus-stops.md): stop sequences and the `stopTimes` cross-check
- [Docs index](../README.md): writing rules
