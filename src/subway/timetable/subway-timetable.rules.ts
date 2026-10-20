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

export function findTimetable(timetables: readonly Timetable[], platform: NetworkPlatform, dayType: DayType): Timetable | null {
  const [operator] = platform.id.split("-");
  const isPlatformTable = (timetable: Timetable): boolean => timetable.operator === operator && timetable.line === platform.line;
  return timetables.find((t) => isPlatformTable(t) && t.dayType === dayType) ?? null;
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

export function toTimetableKey({ operator, line, dayType }: Pick<Timetable, "operator" | "line" | "dayType">): string {
  return `${operator}-${line}-${dayType}`;
}

// WHY: one issue per missing table, naming every platform it serves, so a push refusal lists each platform and day type.
export function toTimetableCoverageIssues(timetables: readonly Timetable[], platforms: readonly NetworkPlatform[]): NetworkIssue[] {
  const missingByKey = new Map<string, string[]>();
  for (const platform of platforms) {
    for (const dayType of TIMETABLE_DAY_TYPES[platform.timetable.source].filter((each) => findTimetable(timetables, platform, each) === null)) {
      const key = toTimetableKey({ operator: platform.id.split("-")[0] ?? "", line: platform.line, dayType });
      missingByKey.set(key, [...(missingByKey.get(key) ?? []), `${platform.id} ${dayType}`]);
    }
  }
  return [...missingByKey].map(([key, missing]) => ({ path: [key], message: `no table for ${missing.join(", ")}` }));
}

export function isInServiceWindow(dayType: DayType, serviceDate: string, now: Date): boolean {
  const secondsOfServiceDay = (now.getTime() - toServiceInstant(serviceDate, 0).getTime()) / SECOND_MS;
  return secondsOfServiceDay >= SERVICE_WINDOW_OPENS_SEC && secondsOfServiceDay < SERVICE_WINDOW_CLOSES_SEC[dayType];
}
