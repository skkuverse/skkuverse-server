import { isCalendarDate } from "../shared/calendar-date.util";
import { LEAP_YEAR, REST_DAY_YEARS } from "./calendar.constants";
import type { RestDays } from "./calendar.types";

const ANNUAL_KEY = /^\d{2}-\d{2}$/;
const EXACT_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** WHY: MM-DD recurs every year, YYYY-MM-DD applies once; the key's shape says which. */
export function isRestDayKey(key: string): boolean {
  if (ANNUAL_KEY.test(key)) return isCalendarDate(`${LEAP_YEAR}-${key}`);
  if (!EXACT_KEY.test(key) || !isCalendarDate(key)) return false;
  const year = Number(key.slice(0, 4));
  return year >= REST_DAY_YEARS.first && year <= REST_DAY_YEARS.last;
}

export function toRestDays(labelByKey: Readonly<Record<string, string>>): RestDays {
  const restDays: RestDays = { exact: new Map(), annual: new Map() };
  for (const [key, label] of Object.entries(labelByKey)) (ANNUAL_KEY.test(key) ? restDays.annual : restDays.exact).set(key, label);
  return restDays;
}

/** WHY: exact date first, then the yearly MM-DD rule. */
export function lookupRestDay(restDays: RestDays, dateStr: string): string | null {
  return restDays.exact.get(dateStr) ?? restDays.annual.get(dateStr.slice(5)) ?? null;
}
