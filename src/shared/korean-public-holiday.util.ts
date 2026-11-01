import Holidays from "date-holidays";
import moment from "moment-timezone";
import { KST_TIME_ZONE } from "./time-zone.constants";

const DATE_FORMAT = "YYYY-MM-DD";

// QUIRK(date-holidays): computes KR public and substitute holidays for any year (3.37.0, checked 2026-10-16),
// but cannot predict temporary holidays or election days.
const krHolidays = new Holidays("KR");

// EVIDENCE: date-holidays never returned for an Invalid Date or a year-0 or year-1 day, and read 2026-02-29 as
// the March 1 holiday (a standalone run, 2026-10-16); 1900 and 2999 answer, and callers ask for days near today.
const HOLIDAY_YEARS = { first: 1900, last: 2999 } as const;

export function toHolidayYear(dateStr: string): number {
  const day = moment.tz(dateStr, DATE_FORMAT, true, KST_TIME_ZONE);
  if (!day.isValid() || day.year() < HOLIDAY_YEARS.first || day.year() > HOLIDAY_YEARS.last) {
    throw new RangeError(`${dateStr} is not a date from ${HOLIDAY_YEARS.first} to ${HOLIDAY_YEARS.last}`);
  }
  return day.year();
}

// EVIDENCE: about 1.5 ms per isHoliday; a route request asks for 14 dates about 57 times (2026-10-31).
// Callers ask for days near today, so the map stays small.
const answered = new Map<string, string | null>();

// WHY: noon KST resolves the date whatever the host's time zone.
export function lookupKoreanPublicHoliday(dateStr: string): string | null {
  toHolidayYear(dateStr);
  if (answered.has(dateStr)) return answered.get(dateStr) ?? null;
  const holidays = krHolidays.isHoliday(new Date(`${dateStr}T12:00:00+09:00`));
  const name = (holidays && holidays.find((h) => h.type === "public")?.name) || null;
  answered.set(dateStr, name);
  return name;
}
