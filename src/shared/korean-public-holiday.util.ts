import Holidays from "date-holidays";
import moment from "moment-timezone";
import { KST_TIME_ZONE } from "./time-zone.constants";

const DATE_FORMAT = "YYYY-MM-DD";

// QUIRK(date-holidays): computes KR public holidays for any year, but has no substitute-holiday rule (3.30.2,
// checked 2026-10-16), and cannot predict ad-hoc holidays either.
const krHolidays = new Holidays("KR");

// EVIDENCE: date-holidays never returned for an Invalid Date or a year-0 or year-1 day, and read 2026-02-29 as
// the March 1 holiday (a standalone run, 2026-10-16); 1900 and 2999 answer, and callers ask for days near today.
const HOLIDAY_YEARS = { first: 1900, last: 2999 } as const;

// WHY: noon KST resolves the date whatever the host's time zone.
export function lookupKoreanPublicHoliday(dateStr: string): string | null {
  const day = moment.tz(dateStr, DATE_FORMAT, true, KST_TIME_ZONE);
  if (!day.isValid() || day.year() < HOLIDAY_YEARS.first || day.year() > HOLIDAY_YEARS.last) {
    throw new RangeError(`${dateStr} is not a date from ${HOLIDAY_YEARS.first} to ${HOLIDAY_YEARS.last}`);
  }
  const holidays = krHolidays.isHoliday(new Date(`${dateStr}T12:00:00+09:00`));
  return (holidays && holidays.find((h) => h.type === "public")?.name) || null;
}
