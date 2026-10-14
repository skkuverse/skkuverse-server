import moment from "moment-timezone";
import { DailyCapError } from "../../shared/daily-cap.error";
import { haversineM } from "../../shared/distance.util";
import type { DirectionsProvider } from "../../shared/directions.types";
import type { ScheduleDay } from "../schedule/bus-schedule.wire";
import type { EtaOptIns, ScheduleStopCatalog } from "../stops/bus-stops.types";
import type { LatLng } from "../../shared/lat-lng.types";
import type { EtaRun, EtaSequence, OffsetCheck, SequenceLength, SequenceRef } from "./bus-eta.types";

const TZ = "Asia/Seoul";
const MAX_STOP_DISTANCE_M = 150;

/**
 * WHY: a resolved day's runs of one route type. An entry counts only when its `stopTimes` has one item per sequence
 * stop; two entries at the same time are one run: the estimate is a travel time, the same for every bus then.
 */
export function runsOfDay(day: ScheduleDay, { serviceId, routeType, sequenceLength }: SequenceRef): EtaRun[] {
  if (day.display !== "schedule") return [];
  const seen = new Set<string>();
  return day.schedule.flatMap((entry) => {
    if (entry.routeType !== routeType || typeof entry.time !== "string") return [];
    if (!Array.isArray(entry.stopTimes) || entry.stopTimes.length !== sequenceLength || seen.has(entry.time)) return [];
    seen.add(entry.time);
    const departAt = moment.tz(`${day.date} ${entry.time}`, "YYYY-MM-DD HH:mm", TZ).toDate();
    return [{ serviceId, routeType, date: day.date, time: entry.time, departAt }];
  });
}

// WHY: the catalog loader refused an opted-in sequence that is missing, holds a label or lacks coordinates, so a
// throw here means the loader and this disagree.
export function toEtaSequences(catalog: Readonly<ScheduleStopCatalog>, optIns: EtaOptIns): EtaSequence[] {
  const coords = new Map(catalog.stops.map((s) => [s.id, s.coords]));
  const coordsOf = (stopId: string | undefined): LatLng => {
    const found = stopId === undefined ? undefined : coords.get(stopId);
    if (!found) throw new Error(`schedule-stops.json: opted-in stop ${stopId} has no coordinates`);
    return found;
  };
  return [...optIns].flatMap(([serviceId, routeTypes]) =>
    routeTypes.map((routeType) => {
      const sequence = catalog.sequences[serviceId]?.[routeType];
      if (!sequence) throw new Error(`schedule-stops.json: no ${serviceId} ${routeType} sequence to estimate`);
      return { serviceId, routeType, stops: sequence.map((stop) => coordsOf(stop.stopId)) };
    }),
  );
}

export function toSequenceLength(sequences: readonly EtaSequence[]): SequenceLength {
  const lengths = new Map(sequences.map((s) => [`${s.serviceId}|${s.routeType}`, s.stops.length]));
  return (serviceId, routeType) => lengths.get(`${serviceId}|${routeType}`);
}

/**
 * WHY: calls left today for one provider, starting over at 00:00 KST. The counter lives in the poller process, the
 * only caller; a restart starts it over, which the providers' own limits still bound.
 */
export class DailyCap {
  private day = "";
  private used = 0;

  constructor(
    private readonly provider: DirectionsProvider,
    private readonly cap: number,
  ) {}

  take(now: Date): void {
    const day = moment(now).tz(TZ).format("YYYY-MM-DD");
    if (day !== this.day) {
      this.day = day;
      this.used = 0;
    }
    if (this.used >= this.cap) throw new DailyCapError(this.provider, this.cap);
    this.used += 1;
  }
}

/** WHY: a router's stop times never run backwards and add up to its own route total, within a tolerance. */
export function orderAndTotalIssue(offsets: readonly number[], { routeTotal, maxMismatch, unit }: OffsetCheck): string | null {
  for (const [index, offset] of offsets.entries()) {
    const previous = offsets[index - 1];
    if (previous !== undefined && offset < previous) return `stop ${index} is reached before stop ${index - 1} (${offset} ${unit} < ${previous} ${unit})`;
  }
  const total = offsets.at(-1);
  if (total === undefined || Math.abs(total - routeTotal) <= maxMismatch) return null;
  return `the stop times add up to ${total} ${unit} but the route total is ${routeTotal} ${unit}`;
}

// WHY: a router that avoids campus roads drops a stop on an outside road, which shows as a stop far from its point.
export function stopDistanceIssue(stop: LatLng, point: LatLng, index: number): string | null {
  const meters = haversineM(point, stop);
  if (meters <= MAX_STOP_DISTANCE_M) return null;
  return `stop ${index} is ${Math.round(meters)} m from where the route places it (limit ${MAX_STOP_DISTANCE_M} m)`;
}
