import moment from "moment-timezone";
import { toKstDate } from "../../shared/kst-date.util";
import { KST_TIME_ZONE } from "../../shared/time-zone.constants";
import { SUBWAY_STATIONS } from "../subway.constants";
import type { NetworkIssue, NetworkPlatform, SubwayDirection } from "../subway.types";
import {
  ADJACENT_PLATFORM_ID_PAIRS,
  MAX_UNOBSERVED_RUN_SEC,
  MIN_VIEW_BEFORE_PLATFORM_SEC,
  RUN_START_PLATFORM_IDS,
  SERVICE_DAY_START_HOUR,
  SERVICE_WINDOW_CLOSES_SEC,
  SERVICE_WINDOW_OPENS_SEC,
  TIMETABLE_DAY_TYPES,
} from "./subway-timetable.constants";
import type { DayType, LineRoutes, ScheduledTrain, Timetable, TimetableSource, TimetableStop } from "./subway-timetable.types";

const HOUR_MS = 3_600_000;
const SECOND_MS = 1000;
const SUNDAY = 0;
const SATURDAY = 6;
const SHOWN_TRAIN_COUNT = 3;

export function listSubwayPlatforms(): NetworkPlatform[] {
  return SUBWAY_STATIONS.flatMap((station) => station.platforms);
}

export function findSubwayPlatform(id: string): NetworkPlatform | null {
  return listSubwayPlatforms().find((platform) => platform.id === id) ?? null;
}

export function toServiceDate(instant: Date): string {
  return toKstDate(new Date(instant.getTime() - SERVICE_DAY_START_HOUR * HOUR_MS));
}

export function toDayType(source: TimetableSource, serviceDate: string, isPublicHoliday: boolean): DayType {
  const weekday = new Date(`${serviceDate}T00:00:00Z`).getUTCDay();
  if (isPublicHoliday || weekday === SUNDAY) return "holiday";
  if (weekday !== SATURDAY) return "weekday";
  return TIMETABLE_DAY_TYPES[source].includes("saturday") ? "saturday" : "holiday";
}

export function toServiceInstant(serviceDate: string, secondsOfServiceDay: number): Date {
  return new Date(moment.tz(serviceDate, KST_TIME_ZONE).valueOf() + secondsOfServiceDay * SECOND_MS);
}

export function toTimetableKey({ operator, line, dayType }: Pick<Timetable, "operator" | "line" | "dayType">): string {
  return `${operator}-${line}-${dayType}`;
}

export function toPlatformTimetableKey(platform: NetworkPlatform, dayType: DayType): string {
  return toTimetableKey({ operator: platform.id.split("-")[0] ?? "", line: platform.line, dayType });
}

export function findTimetable(timetables: readonly Timetable[], platform: NetworkPlatform, dayType: DayType): Timetable | null {
  return timetables.find((t) => toTimetableKey(t) === toPlatformTimetableKey(platform, dayType)) ?? null;
}

// WHY: every tick reads tables of tens of thousands of stop times, so the time zone is applied once per table,
// not once per time.
export function toScheduledTrains(timetable: Timetable, serviceDate: string): ScheduledTrain[] {
  const midnightMs = toServiceInstant(serviceDate, 0).getTime();
  const toInstant = (seconds: number | null): Date | null => (seconds === null ? null : new Date(midnightMs + seconds * SECOND_MS));
  return timetable.trains.map(({ stops, ...train }) => ({
    ...train,
    stops: stops.map((stop) => ({ platformId: stop.station, arrivalAt: toInstant(stop.arr), departureAt: toInstant(stop.dep) })),
  }));
}

function toRoute(timetable: Timetable, direction: SubwayDirection): readonly string[] {
  const listed = timetable.stations;
  const stops = timetable.trains.find((t) => t.direction === direction && t.stops.length > 1)?.stops ?? [];
  const [first, last] = [stops[0], stops.at(-1)].map((stop) => listed.indexOf(stop?.station ?? ""));
  return (first ?? 0) <= (last ?? 0) ? listed : [...listed].reverse();
}

export function toLineRoutes(timetable: Timetable): LineRoutes {
  return { up: toRoute(timetable, "up"), down: toRoute(timetable, "down") };
}

// WHY: by missing table, every platform it would serve, so a push refusal and the read's gap line name each one.
export function toUncoveredPlatformIdsByKey(keys: ReadonlySet<string>, platforms: readonly NetworkPlatform[]): Map<string, string[]> {
  const platformIdsByKey = new Map<string, string[]>();
  const uncovered = platforms.flatMap((platform) =>
    TIMETABLE_DAY_TYPES[platform.timetable.source].map((dayType) => ({ key: toPlatformTimetableKey(platform, dayType), id: platform.id })),
  );
  for (const { key, id } of uncovered.filter((each) => !keys.has(each.key))) platformIdsByKey.set(key, [...(platformIdsByKey.get(key) ?? []), id]);
  return platformIdsByKey;
}

export function toTimetableCoverageIssues(timetables: readonly Timetable[], platforms: readonly NetworkPlatform[]): NetworkIssue[] {
  const uncovered = toUncoveredPlatformIdsByKey(new Set(timetables.map(toTimetableKey)), platforms);
  return [...uncovered].map(([key, ids]) => ({ path: [key], message: `no table for ${ids.map((id) => `${id} ${key.split("-").at(-1)}`).join(", ")}` }));
}

// WHY: a table last used for an earlier service day goes unless this day needs it again, so a process holds at most
// one day type per line and a weekday's tables, kept from Tuesday into Wednesday, are not read again.
export function toEvictedTimetableKeys(held: ReadonlyMap<string, { lastServiceDate: string }>, serviceDate: string, neededKeys: ReadonlySet<string>): string[] {
  return [...held].filter(([key, { lastServiceDate }]) => lastServiceDate < serviceDate && !neededKeys.has(key)).map(([key]) => key);
}

function isInServiceWindowSec(dayType: DayType, secondsOfServiceDay: number): boolean {
  return secondsOfServiceDay >= SERVICE_WINDOW_OPENS_SEC && secondsOfServiceDay < SERVICE_WINDOW_CLOSES_SEC[dayType];
}

export function isInServiceWindow(dayType: DayType, serviceDate: string, now: Date): boolean {
  return isInServiceWindowSec(dayType, (now.getTime() - toServiceInstant(serviceDate, 0).getTime()) / SECOND_MS);
}

interface TrackedStops {
  path: NetworkIssue["path"];
  platformId: string;
  stations: readonly string[];
  trains: Array<{ trainNo: string; stops: readonly TimetableStop[] }>;
}

function toTrackedStops(timetable: Timetable, platform: NetworkPlatform): TrackedStops[] {
  const routes = toLineRoutes(timetable);
  return (["up", "down"] as const).map((direction) => {
    const stations = routes[direction].slice(0, routes[direction].indexOf(platform.id) + 1);
    const trains = timetable.trains
      .filter((t) => t.direction === direction && t.stops.some((stop) => stop.station === platform.id))
      .map((t) => ({ trainNo: t.trainNo, stops: t.stops.filter((stop) => stations.includes(stop.station)) }));
    return { path: [toTimetableKey(timetable), platform.id, direction], platformId: platform.id, stations, trains };
  });
}

function longRuns({ trains }: TrackedStops): string[] {
  return trains.flatMap(({ trainNo, stops }) =>
    stops.slice(1).flatMap((stop, index) => {
      const from = stops[index];
      const leftAt = from?.dep ?? from?.arr ?? null;
      const runSec = stop.arr === null || leftAt === null ? 0 : stop.arr - leftAt;
      return runSec > MAX_UNOBSERVED_RUN_SEC ? [`${trainNo} ${from?.station}→${stop.station} ${runSec} s`] : [];
    }),
  );
}

function shortViews({ trains, platformId }: TrackedStops): string[] {
  return trains.flatMap(({ trainNo, stops }) => {
    const [first] = stops;
    const at = stops.find((stop) => stop.station === platformId);
    if (!first || !at || first === at || first.arr === null || RUN_START_PLATFORM_IDS.includes(first.station)) return [];
    const viewSec = (at.arr ?? at.dep ?? 0) - first.arr;
    return viewSec < MIN_VIEW_BEFORE_PLATFORM_SEC ? [`${trainNo} from ${first.station} ${viewSec} s`] : [];
  });
}

function isAdjacent(before: string, after: string): boolean {
  const codeOf = (id: string): number => Number(id.slice(-2));
  const isListedPair = ADJACENT_PLATFORM_ID_PAIRS.some((pair) => pair.includes(before) && pair.includes(after));
  return Math.abs(codeOf(before) - codeOf(after)) === 1 || isListedPair;
}

const listed = (rows: readonly string[]): string => rows.slice(0, SHOWN_TRAIN_COUNT).join(", ") + (rows.length > SHOWN_TRAIN_COUNT ? ", ..." : "");

// WHY: the tracker sees a train only at the stops it follows to a platform, so a long run between two of them, a
// train in view too briefly before the platform or a station skipped between them leaves its estimate blind there.
export function toTrackedStopIssues(timetables: readonly Timetable[], platforms: readonly NetworkPlatform[]): NetworkIssue[] {
  const tracked = timetables.flatMap((t) => platforms.filter((p) => toPlatformTimetableKey(p, t.dayType) === toTimetableKey(t)).flatMap((p) => toTrackedStops(t, p)));
  return tracked.flatMap((each) => {
    const [runs, views] = [longRuns(each), shortViews(each)];
    const skips = each.stations.slice(1).flatMap((id, index) => {
      const before = each.stations[index] ?? "";
      return isAdjacent(before, id) ? [] : [`the tracked stops skip a station between ${before} and ${id}`];
    });
    return [
      ...(runs.length > 0 ? [`${runs.length} train(s) run over ${MAX_UNOBSERVED_RUN_SEC} s between two tracked stops: ${listed(runs)}`] : []),
      ...(views.length > 0 ? [`${views.length} train(s) in view under ${MIN_VIEW_BEFORE_PLATFORM_SEC} s before it: ${listed(views)}`] : []),
      ...skips,
    ].map((message) => ({ path: each.path, message }));
  });
}

function toStopTimesOutsideServiceWindow(timetable: Timetable, platform: NetworkPlatform): string[] {
  const isOutside = (seconds: number | null): seconds is number => seconds !== null && !isInServiceWindowSec(timetable.dayType, seconds);
  return timetable.trains.flatMap(({ trainNo, stops }) =>
    stops.filter((stop) => stop.station === platform.id).flatMap((stop) => [stop.arr, stop.dep].filter(isOutside).map((seconds) => `${trainNo} ${seconds} s`)),
  );
}

// WHY: the tracker observes only inside the service window, so a stop time outside it would never be tracked.
export function toServiceWindowIssues(timetables: readonly Timetable[], platforms: readonly NetworkPlatform[]): NetworkIssue[] {
  const servedBy = (timetable: Timetable) => platforms.filter((p) => toPlatformTimetableKey(p, timetable.dayType) === toTimetableKey(timetable));
  return timetables.flatMap((timetable) =>
    servedBy(timetable).flatMap((platform) => {
      const outside = toStopTimesOutsideServiceWindow(timetable, platform);
      return outside.length > 0 ? [{ path: [toTimetableKey(timetable), platform.id], message: `${outside.length} stop time(s) outside the service window: ${listed(outside)}` }] : [];
    }),
  );
}
