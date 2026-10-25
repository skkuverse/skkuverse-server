import moment from "moment-timezone";
import { lookupKoreanPublicHoliday } from "./korean-public-holiday.util";
import { KST_TIME_ZONE } from "./time-zone.constants";

const SATURDAY_ISO_WEEKDAY = 6;

export function toKstDate(instant: Date): string {
  return moment(instant).tz(KST_TIME_ZONE).format("YYYY-MM-DD");
}

export function toKstInstant(ms: number): string {
  return moment(ms).tz(KST_TIME_ZONE).format("YYYY-MM-DDTHH:mm:ssZ");
}

export function toKstTimeOfDay(instant: Date): string {
  return moment(instant).tz(KST_TIME_ZONE).format("HH:mm");
}

export function isKstRestDay(instant: Date): boolean {
  return moment(instant).tz(KST_TIME_ZONE).isoWeekday() >= SATURDAY_ISO_WEEKDAY || lookupKoreanPublicHoliday(toKstDate(instant)) !== null;
}
