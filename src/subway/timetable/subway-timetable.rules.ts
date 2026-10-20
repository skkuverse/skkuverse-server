import moment from "moment-timezone";
import { toKstDate } from "../../shared/kst-date.util";
import { KST_TIME_ZONE } from "../../shared/time-zone.constants";
import { SUBWAY_STATIONS } from "../subway.constants";
import type { NetworkIssue, NetworkPlatform, SubwayDirection } from "../subway.types";
import {
  SERVICE_DAY_START_HOUR,
  SERVICE_WINDOW_CLOSES_SEC,
  SERVICE_WINDOW_OPENS_SEC,
  TIMETABLE_DAY_TYPES,
} from "./subway-timetable.constants";
import type { DayType, LineRoutes, ScheduledTrain, Timetable, TimetableSource } from "./subway-timetable.types";

const HOUR_MS = 3_600_000;
const SECOND_MS = 1000;
const SUNDAY = 0;
const SATURDAY = 6;

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

export function isInServiceWindow(dayType: DayType, serviceDate: string, now: Date): boolean {
  const secondsOfServiceDay = (now.getTime() - toServiceInstant(serviceDate, 0).getTime()) / SECOND_MS;
  return secondsOfServiceDay >= SERVICE_WINDOW_OPENS_SEC && secondsOfServiceDay < SERVICE_WINDOW_CLOSES_SEC[dayType];
}
