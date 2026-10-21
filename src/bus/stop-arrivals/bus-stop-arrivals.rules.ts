import moment from "moment-timezone";
import { KST_TIME_ZONE } from "../../shared/time-zone.constants";
import { HSSC_POSITION_COUNT } from "../bus.constants";
import type { RealtimeBus } from "../realtime/group/bus-realtime-group.wire";
import type { SmartSchedule } from "../schedule/bus-schedule.wire";
import type { ShuttleStopRoute } from "../stop-index/bus-stop-index.types";
import { NEXT_RUN_COUNT } from "./bus-stop-arrivals.constants";
import type { Approaching, ScheduledRun } from "./bus-stop-arrivals.types";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

type RunStop = Pick<ShuttleStopRoute, "routeType" | "sequenceIndex" | "timing">;

// WHY: the HSSC line is a loop drawn from 농구장, so a bus past the stop reaches it on its next lap; positions count
// as the realtime screen draws them, the non-stop rows included, and a bus at the stop is 0 (D8).
export function toApproaching(buses: ReadonlyArray<Pick<RealtimeBus, "stationIndex">>, stationIndex: number): Approaching[] {
  return buses
    .map((bus) => (stationIndex - bus.stationIndex + HSSC_POSITION_COUNT) % HSSC_POSITION_COUNT)
    .sort((a, b) => a - b)
    .map((stopsAway) => ({ stopsAway }));
}

const toKstMs = (date: string, time: string): number => moment.tz(`${date} ${time}`, "YYYY-MM-DD HH:mm", KST_TIME_ZONE).valueOf();

// WHY: a time at the stop before the departure is past midnight, the next day's.
function toRunAtMs(date: string, departure: string, time: string | null): number {
  const departureMs = toKstMs(date, departure);
  if (time === null) return departureMs;
  const timeMs = toKstMs(date, time);
  return timeMs < departureMs ? timeMs + DAY_MS : timeMs;
}

/**
 * WHY: the next runs at one stop of a smart schedule with its estimates applied, ordered by their time here, or their
 * departure when that is unknown; a run still counts in its own minute, as the timetable gives minutes (D9).
 */
export function toNextRuns(schedule: SmartSchedule, { routeType, sequenceIndex, timing }: RunStop, now: Date): ScheduledRun[] {
  if (schedule.status !== "active") return [];
  const fromMs = Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS;
  const runs = schedule.days.flatMap(({ date, schedule: entries }) =>
    entries.flatMap(({ routeType: entryRouteType, time: departure, stopTimes, eta }) => {
      if (entryRouteType !== routeType || typeof departure !== "string") return [];
      const time = stopTimes?.[sequenceIndex] ?? null;
      const run: ScheduledRun = { date, departure, time, estimated: time !== null && timing === "estimated" && eta !== undefined };
      return [{ atMs: toRunAtMs(date, departure, time), run }];
    }),
  );
  return runs
    .filter(({ atMs }) => atMs >= fromMs)
    .sort((a, b) => a.atMs - b.atMs)
    .slice(0, NEXT_RUN_COUNT)
    .map(({ run }) => run);
}
