export const SKKU_REST_DAYS_DATASET = "skku-rest-days";

// WHY: the years the public-holiday lookup answers (toHolidayYear), so every stored date can be looked up.
export const REST_DAY_YEARS = { first: 1900, last: 2999 } as const;

// WHY: a leap year, so a yearly 02-29 is a month-day the calendar has.
export const LEAP_YEAR = 2000;

// WHY: a missing, invalid or unreadable dataset recurs on every read; one line a minute, as docs/reference/logging.md asks.
export const REST_DAYS_LOG_INTERVAL_MS = 60_000;
