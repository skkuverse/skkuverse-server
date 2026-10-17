import moment from "moment-timezone";
import { toKstDate } from "../../shared/kst-date.util";
import { KST_TIME_ZONE } from "../../shared/time-zone.constants";
import { SUBWAY_REGISTRY } from "../subway.config";
import type { SubwayDirection, SubwayPlatform, SubwayRegistry } from "../subway.types";
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

export function listSubwayPlatforms(registry: SubwayRegistry = SUBWAY_REGISTRY): SubwayPlatform[] {
  return registry.stations.flatMap((station) => station.platforms);
}

export function findSubwayPlatform(id: string, registry: SubwayRegistry = SUBWAY_REGISTRY): SubwayPlatform | null {
  return listSubwayPlatforms(registry).find((platform) => platform.id === id) ?? null;
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

export function findTimetable(timetables: readonly Timetable[], platform: SubwayPlatform, dayType: DayType): Timetable | null {
  const [operator] = platform.id.split("-");
  const isPlatformTable = (timetable: Timetable): boolean => timetable.operator === operator && timetable.line === platform.line;
  return timetables.find((t) => isPlatformTable(t) && t.dayType === dayType) ?? null;
}

export function toScheduledTrains(timetable: Timetable, serviceDate: string): ScheduledTrain[] {
  const toInstant = (seconds: number | null): Date | null => (seconds === null ? null : toServiceInstant(serviceDate, seconds));
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

export function assertTimetablesCover(platforms: readonly SubwayPlatform[], timetables: readonly Timetable[]): void {
  const missing = platforms.flatMap((platform) =>
    TIMETABLE_DAY_TYPES[platform.timetable.source]
      .filter((dayType) => findTimetable(timetables, platform, dayType) === null)
      .map((dayType) => `${platform.id} ${dayType}`),
  );
  if (missing.length > 0) throw new Error(`subway timetables: no table for ${missing.join(", ")}`);
}

export function isInServiceWindow(dayType: DayType, serviceDate: string, now: Date): boolean {
  const secondsOfServiceDay = (now.getTime() - toServiceInstant(serviceDate, 0).getTime()) / SECOND_MS;
  return secondsOfServiceDay >= SERVICE_WINDOW_OPENS_SEC && secondsOfServiceDay < SERVICE_WINDOW_CLOSES_SEC[dayType];
}
