import moment from "moment-timezone";
import { KST_TIME_ZONE } from "../../shared/time-zone.constants";

// WHY: the sync ticks hourly so a failed year retries within the hour; a stored year is refetched once a day.
const STORED_YEAR_MAX_AGE_MS = 24 * 60 * 60_000;

export function toSyncYears(now: Date): number[] {
  const thisYear = moment(now).tz(KST_TIME_ZONE).year();
  return [thisYear, thisYear + 1];
}

export function isStoredYearFresh(fetchedAt: Date, now: Date): boolean {
  return now.getTime() - fetchedAt.getTime() < STORED_YEAR_MAX_AGE_MS;
}
