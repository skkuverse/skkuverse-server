import moment from "moment-timezone";
import { LEAP_YEAR, REST_DAY_YEARS } from "./bus-schedule-content.constants";
import type { BusServiceNotices } from "./bus-schedule-content.schema";
import type { BusServiceReference, RestDays } from "./bus-schedule-content.types";

const DATE_FORMAT = "YYYY-MM-DD";
const ANNUAL_KEY = /^\d{2}-\d{2}$/;
const EXACT_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** WHY: strict, so a month or day that is out of range or not zero-padded is no date. */
export function isCalendarDate(value: string): boolean {
  return moment(value, DATE_FORMAT, true).isValid();
}

/** WHY: a push may name only services the code defines; the data tool resolves each against `busServices`. */
export function serviceNoticesReferences({ services }: BusServiceNotices): BusServiceReference[] {
  return Object.keys(services).map((serviceId) => ({ dataset: "busServices", id: serviceId, path: ["services", serviceId] }));
}

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
