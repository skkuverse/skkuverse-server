import moment from "moment-timezone";
import "moment/locale/ko";
import { KST_TIME_ZONE } from "../../../shared/time-zone.constants";
import { HSSC_POSITION_COUNT } from "../../bus.constants";
import type { HsscAnchorRow, HsscApiBus, HsscBusDoc } from "../../cache/bus-cache.document";
import {
  HSSC_API_DATE_FORMAT,
  HSSC_EVENT_DATE_FORMAT,
  LIVE_STALE_MINUTES_AT_TURNAROUND,
  MAX_BACKWARD_POSITIONS,
  STALE_MINUTES,
  STALE_MINUTES_AT_TURNAROUND,
  TURNAROUND_STATION_NAME,
} from "./bus-realtime-hssc.constants";
import type { HsscFeedEventTiming, HsscStopEvent } from "./bus-realtime-hssc.types";

const SEQ_PATTERN = /^\d+$/;

// QUIRK(hssc): seq is the stop's index on the circular route (0-10); the app counts stops 1-11 from the
// first stop after the turnaround, so 5 → 1 … 10 → 6 and 0 → 7 … 4 → 11.
export function toLinearSequence(seq: number): number {
  return seq >= 5 ? seq - 4 : seq + 7;
}

// WHY: a bus seen at the same stop on the previous tick keeps its first sighting, so its dwell time grows.
export function toFirstSeenAt(item: HsscApiBus, previous: readonly HsscBusDoc[]): moment.Moment {
  const seen = previous.find((bus) => bus.line_no === item.line_no && bus.stop_no === item.stop_no);
  if (seen && seen.eventDate) return moment.tz(seen.eventDate, HSSC_EVENT_DATE_FORMAT, KST_TIME_ZONE);
  return moment.tz(item.get_date, HSSC_API_DATE_FORMAT, "ko", KST_TIME_ZONE);
}

export function toDwellSeconds(firstSeenAt: moment.Moment, now: Date): number {
  return Math.round(Math.abs((now.getTime() - firstSeenAt.valueOf()) / 1000));
}

type FreshnessFields = Pick<HsscBusDoc, "stationName" | "eventDate">;

export function isFresh(bus: FreshnessFields, now: Date): boolean {
  return isFreshWithin(bus, now, STALE_MINUTES_AT_TURNAROUND);
}

export function isLiveFresh(bus: FreshnessFields, now: Date): boolean {
  return isFreshWithin(bus, now, LIVE_STALE_MINUTES_AT_TURNAROUND);
}

function isFreshWithin(bus: FreshnessFields, now: Date, staleMinutesAtTurnaround: number): boolean {
  const staleMinutes = bus.stationName === TURNAROUND_STATION_NAME ? staleMinutesAtTurnaround : STALE_MINUTES;
  const firstSeenAt = moment.tz(bus.eventDate, HSSC_EVENT_DATE_FORMAT, KST_TIME_ZONE);
  const cutoff = moment(now).tz(KST_TIME_ZONE).subtract(staleMinutes, "minutes");
  return !firstSeenAt.isBefore(cutoff);
}

// WHY: the feed repeats an event on every tick until the bus reaches its next stop; this is the event's identity.
export function toFeedEventKey(item: HsscApiBus): string {
  return [item.line_no, item.seq, item.get_date, item.inout].join("|");
}

// WHY: strict, so a row in another shape is left out of the event log rather than stored at a guessed instant.
export function toFeedEventTiming(item: Pick<HsscApiBus, "seq" | "get_date">): HsscFeedEventTiming | null {
  const getDate = moment.tz(item.get_date, HSSC_API_DATE_FORMAT, "ko", true, KST_TIME_ZONE);
  if (!SEQ_PATTERN.test(item.seq) || !getDate.isValid()) return null;
  return { seq: parseInt(item.seq, 10), getDate: getDate.toDate() };
}

// WHY: an entry an older poller wrote has no anchor row, so the feed's row anchors (ADR 0012, D1).
export function toHsscStopEvent(bus: HsscBusDoc): HsscStopEvent | null {
  const row = bus.anchorRow ?? bus;
  const timing = toFeedEventTiming(row);
  const firstSeenAt = moment.tz(row.eventDate, HSSC_EVENT_DATE_FORMAT, true, KST_TIME_ZONE);
  if (!timing || !firstSeenAt.isValid()) return null;
  return { vehicleId: bus.line_no, seq: timing.seq, inout: row.inout, eventAt: timing.getDate, firstSeenAt: firstSeenAt.toDate() };
}

// WHY: the turnaround is never held off, since a lap ends there (ADR 0018, D8).
function isBackwardInLap(from: HsscAnchorRow, to: HsscAnchorRow): boolean {
  const backward = (toLinearSequence(parseInt(from.seq, 10)) - toLinearSequence(parseInt(to.seq, 10)) + HSSC_POSITION_COUNT) % HSSC_POSITION_COUNT;
  return to.stationName !== TURNAROUND_STATION_NAME && backward >= 1 && backward <= MAX_BACKWARD_POSITIONS;
}

/** WHY: the bus's previous anchor row, held while still fresh against a feed row that puts the bus back in its lap. */
export function toHeldAnchorRow(bus: HsscBusDoc, previous: readonly HsscBusDoc[], now: Date): HsscAnchorRow | null {
  const seen = previous.find((previousBus) => previousBus.line_no === bus.line_no);
  if (!seen) return null;
  const { seq, inout, get_date, stationName, eventDate } = seen.anchorRow ?? seen;
  const held = { seq, inout, get_date, stationName, eventDate };
  return isLiveFresh(held, now) && isBackwardInLap(held, bus) ? held : null;
}

export function isUnparsedFeed(items: readonly HsscApiBus[]): boolean {
  return items.length > 0 && items.every((item) => toFeedEventTiming(item) === null);
}
