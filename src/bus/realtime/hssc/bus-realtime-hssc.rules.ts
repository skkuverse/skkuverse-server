import moment from "moment-timezone";
import "moment/locale/ko";
import type { HsscApiBus, HsscBusDoc } from "../../cache/bus-cache.document";
import {
  HSSC_API_DATE_FORMAT,
  HSSC_EVENT_DATE_FORMAT,
  HSSC_TIME_ZONE,
  STALE_MINUTES,
  STALE_MINUTES_AT_TURNAROUND,
  TURNAROUND_STATION_NAME,
} from "./bus-realtime-hssc.constants";

// QUIRK(hssc): seq is the stop's index on the circular route (0-10); the app counts stops 1-11 from the
// first stop after the turnaround, so 5 → 1 … 10 → 6 and 0 → 7 … 4 → 11.
export function toLinearSequence(seq: number): number {
  return seq >= 5 ? seq - 4 : seq + 7;
}

// WHY: a bus seen at the same stop on the previous tick keeps its first sighting, so its dwell time grows.
export function toFirstSeenAt(item: HsscApiBus, previous: readonly HsscBusDoc[]): moment.Moment {
  const seen = previous.find((bus) => bus.line_no === item.line_no && bus.stop_no === item.stop_no);
  if (seen && seen.eventDate) return moment.tz(seen.eventDate, HSSC_EVENT_DATE_FORMAT, HSSC_TIME_ZONE);
  return moment.tz(item.get_date, HSSC_API_DATE_FORMAT, "ko", HSSC_TIME_ZONE);
}

export function toDwellSeconds(firstSeenAt: moment.Moment, now: Date): number {
  return Math.round(Math.abs((now.getTime() - firstSeenAt.valueOf()) / 1000));
}

export function isFresh(bus: Pick<HsscBusDoc, "stationName" | "eventDate">, now: Date): boolean {
  const staleMinutes = bus.stationName === TURNAROUND_STATION_NAME ? STALE_MINUTES_AT_TURNAROUND : STALE_MINUTES;
  const firstSeenAt = moment.tz(bus.eventDate, HSSC_EVENT_DATE_FORMAT, HSSC_TIME_ZONE);
  const cutoff = moment(now).tz(HSSC_TIME_ZONE).subtract(staleMinutes, "minutes");
  return !firstSeenAt.isBefore(cutoff);
}
