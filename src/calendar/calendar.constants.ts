export const SKKU_REST_DAYS_DATASET = "skku-rest-days";

// WHY: the years the public-holiday lookup answers (toHolidayYear), so every stored date can be looked up.
export const REST_DAY_YEARS = { first: 1900, last: 2999 } as const;

// WHY: a leap year, so a yearly 02-29 is a month-day the calendar has.
export const LEAP_YEAR = 2000;

// WHY: a missing, invalid or unreadable dataset recurs on every read; one line a minute, as docs/reference/logging.md asks.
export const REST_DAYS_LOG_INTERVAL_MS = 60_000;

// WHY: the first month-day of an academic year, as SKKU and the crawler count it.
export const ACADEMIC_YEAR_FIRST_DAY = "03-01";

// SEE: docs/decisions/0021-academic-calendar.md ("D3. The default rule")
export const TERM_ONE_EARLIEST_DAY = "03-02";
export const TERM_TWO_ANCHOR_DAY = "09-01";
export const TERM_WEEKS = 16;
export const DAYS_BACK_TO_NEAREST_MONDAY = 3;

// WHY: a year a fallback answers recurs on every date of it; one line an hour per year shows it without a flood.
export const RULE_FALLBACK_LOG_INTERVAL_MS = 60 * 60_000;
