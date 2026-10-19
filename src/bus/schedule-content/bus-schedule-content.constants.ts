export const BUS_SERVICE_NOTICES_DATASET = "bus-service-notices";

export const SKKU_REST_DAYS_DATASET = "skku-rest-days";

// WHY: the years the public-holiday lookup answers (toHolidayYear), so every stored date can be looked up.
export const REST_DAY_YEARS = { first: 1900, last: 2999 } as const;

// WHY: a leap year, so a yearly 02-29 is a month-day the calendar has.
export const LEAP_YEAR = 2000;

// WHY: a missing, invalid or unreadable dataset recurs on every read; one line a minute, as docs/reference/logging.md asks.
export const BUS_SCHEDULE_CONTENT_LOG_INTERVAL_MS = 60_000;

// CONTRACT(skkuverse-app): skkuverse-app/packages/shared/src/types/bus.ts (`ScheduleNoticeStyle`) names the styles the
// schedule screen draws; any other draws an unstyled banner. It lacks `error`, which design D7 of move-editorial-datasets keeps.
export const SERVICE_NOTICE_STYLES = ["info", "warning", "error", "ai"] as const;
