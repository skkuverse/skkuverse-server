import moment from "moment-timezone";
import { KST_TIME_ZONE } from "../../shared/time-zone.constants";
import { toKstInstant } from "../bus.mapper";
import type { SmartSchedule } from "../schedule/bus-schedule.wire";
import type { ShuttleStopRoute } from "../stop-index/bus-stop-index.types";
import { NEXT_RUN_COUNT } from "./bus-stop-arrivals.constants";
import type { TimetableArrival } from "./bus-stop-arrivals.types";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

type RunStop = Pick<ShuttleStopRoute, "routeType" | "sequenceIndex" | "timing" | "action">;
type ScheduleEntry = SmartSchedule["days"][number]["schedule"][number];
type DatedRun = { atMs: number; arrival: TimetableArrival };
type ListedSchedules = { served: SmartSchedule; latest: SmartSchedule };

const toKstMs = (date: string, time: string): number => moment.tz(`${date} ${time}`, "YYYY-MM-DD HH:mm", KST_TIME_ZONE).valueOf();

// WHY: a time at the stop before the departure is past midnight, the next day's.
function toRunAtMs(date: string, departure: string, time: string | null): number {
  const departureMs = toKstMs(date, departure);
  if (time === null) return departureMs;
  const timeMs = toKstMs(date, time);
  return timeMs < departureMs ? timeMs + DAY_MS : timeMs;
}

// WHY: a boarding stop fills the departure pair, an alighting stop the arrival pair; an estimate the smart view applied
// at an estimated stop is the expected one, any other time the timetable's (ADR 0019, D1).
function toRunInstants(atIso: string | null, isEstimated: boolean, action: RunStop["action"]): Pick<TimetableArrival, "expectedArrivalAt" | "expectedDepartureAt" | "scheduledArrivalAt" | "scheduledDepartureAt"> {
  const [expected, scheduled] = isEstimated ? [atIso, null] : [null, atIso];
  return action === "board"
    ? { expectedArrivalAt: null, expectedDepartureAt: expected, scheduledArrivalAt: null, scheduledDepartureAt: scheduled }
    : { expectedArrivalAt: expected, expectedDepartureAt: null, scheduledArrivalAt: scheduled, scheduledDepartureAt: null };
}

const runSlotOf = (date: string, routeType: string, time: string): string => `${date} ${routeType} ${time}`;

function toLatestStopTimesByRun(latest: SmartSchedule | undefined): Map<string, ScheduleEntry["stopTimes"]> {
  const estimatedRuns = (latest?.days ?? []).flatMap(({ date, schedule: entries }) =>
    entries.flatMap(({ eta, routeType, time, stopTimes }) => (eta && routeType !== undefined && time !== undefined ? [[runSlotOf(date, routeType, time), stopTimes] as const] : [])),
  );
  return new Map(estimatedRuns);
}

// WHY: where the stop shows no timetable time, the run's latest estimate, even one too old to serve, keeps it listed
// until it arrives, and never drops it before the served time it shows (ADR 0019, D12).
function toListedAtMs({ date, departure }: { date: string; departure: string }, shown: { time: string | null; isEstimated: boolean }, latestTime: string | null | undefined): number {
  const shownAtMs = toRunAtMs(date, departure, shown.time);
  const isTimetableTime = shown.time !== null && !shown.isEstimated;
  return isTimetableTime || !latestTime ? shownAtMs : Math.max(toRunAtMs(date, departure, latestTime), shownAtMs);
}

type DayContext = { date: string; lastDeparture: string; latestStopTimesByRun: ReadonlyMap<string, ScheduleEntry["stopTimes"]> };

function toRun({ time: departure, stopTimes, eta }: ScheduleEntry & { time: string }, stop: RunStop, { date, lastDeparture, latestStopTimesByRun }: DayContext): DatedRun {
  const time = stopTimes?.[stop.sequenceIndex] ?? null;
  const isEstimated = time !== null && stop.timing === "estimated" && eta !== undefined;
  const latestTime = latestStopTimesByRun.get(runSlotOf(date, stop.routeType, departure))?.[stop.sequenceIndex];
  const atMs = toListedAtMs({ date, departure }, { time, isEstimated }, latestTime);
  const shownIso = time === null ? null : toKstInstant(toRunAtMs(date, departure, time));
  const arrival: TimetableArrival = {
    status: "scheduled",
    ...toRunInstants(shownIso, isEstimated, stop.action),
    basis: isEstimated ? "estimate" : "timetable",
    stopsAway: null,
    isLastBus: departure === lastDeparture,
    ...{ vehicleId: null, providerText: null },
    runDepartureAt: toKstInstant(toKstMs(date, departure)),
  };
  return { atMs, arrival };
}

function toDayRuns({ date, schedule: entries }: SmartSchedule["days"][number], stop: RunStop, latestStopTimesByRun: DayContext["latestStopTimesByRun"]): DatedRun[] {
  const departures = entries.flatMap((entry) => (entry.routeType === stop.routeType && typeof entry.time === "string" ? [{ ...entry, time: entry.time }] : []));
  const lastDeparture = departures.map(({ time }) => time).sort().at(-1) ?? "";
  return departures.map((entry) => toRun(entry, stop, { date, lastDeparture, latestStopTimesByRun }));
}

/**
 * WHY: the next runs at one stop of a smart schedule with its estimates applied, each listed until its time here passes,
 * where the stop shows none the later of its latest estimate's arrival (`latest`: each run's newest estimate applied)
 * and the served estimate shown, else its departure; a run still counts in its own minute, as the timetable gives minutes (ADR 0019, D12).
 */
export function toTimetableArrivals(schedules: SmartSchedule | ListedSchedules, stop: RunStop, now: Date): TimetableArrival[] {
  const { served: schedule, latest } = "served" in schedules ? schedules : { served: schedules, latest: undefined };
  if (schedule.status !== "active") return [];
  const fromMs = Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS;
  const latestStopTimesByRun = toLatestStopTimesByRun(latest);
  return schedule.days
    .flatMap((day) => toDayRuns(day, stop, latestStopTimesByRun))
    .filter(({ atMs }) => atMs >= fromMs)
    .sort((a, b) => a.atMs - b.atMs)
    .slice(0, NEXT_RUN_COUNT)
    .map(({ arrival }) => arrival);
}

/** WHY: the next station of the HSSC loop a rider can get off at; its next position can be a rotary pass. */
export function toTowards(line: ReadonlyArray<{ name: string; stopId: string | null }>, stationIndex: number): string | null {
  for (let ahead = 1; ahead < line.length; ahead++) {
    const station = line[(stationIndex + ahead) % line.length];
    if (station?.stopId) return station.name;
  }
  return null;
}
