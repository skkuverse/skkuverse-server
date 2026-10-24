import moment from "moment-timezone";
import { t } from "../../../infra/i18n";
import type { SupportedLang } from "../../../infra/types";
import { KST_TIME_ZONE } from "../../../shared/time-zone.constants";
import type { ScheduleDay, ScheduleEntry, SmartSchedule } from "../../schedule/bus-schedule.wire";
import type { SequenceStop } from "../../stops/bus-stops.types";
import { floorAtScheduledStops, runKey, toStopAt, toTimetableAt } from "./bus-eta-smart.rules";
import type { EstimateInputs, ServedEstimate, ShuttleRun } from "./bus-eta-smart.types";

const MINUTE_MS = 60_000;

type StoredRun = { departureAt: Date; storedAts: Array<Date | null>; sequence: readonly SequenceStop[] | undefined };

// WHY: an estimate is a travel time from the departure, shown to the minute as the timetable gives times, and held at
// each scheduled stop until its timetable time; one whose sequence, stop times or offsets do not fit is none.
function toEstimatedAts({ departureAt, storedAts, sequence }: StoredRun, estimate: ServedEstimate | undefined): Array<Date | null> | null {
  if (!sequence || !estimate || storedAts.length !== sequence.length || estimate.offsetsSec.length !== sequence.length) return null;
  const scheduledOffsetsSec = storedAts.map((at, index) => (sequence[index]?.timing === "scheduled" && at !== null ? (at.getTime() - departureAt.getTime()) / 1000 : null));
  return floorAtScheduledStops(estimate.offsetsSec, scheduledOffsetsSec).map((offsetSec, index) =>
    sequence[index]?.timing === "estimated" ? new Date(departureAt.getTime() + Math.round(offsetSec / 60) * MINUTE_MS) : (storedAts[index] ?? null),
  );
}

type RunEntry = { runId: string; routeType: string; date: string; time: string; stopTimes: ScheduleEntry["stopTimes"] };

function toRun({ runId, routeType, date, time, stopTimes: stored }: RunEntry, isLastOfDay: boolean, inputs: EstimateInputs): ShuttleRun {
  const departureAt = toTimetableAt(date, time);
  const storedAts = (Array.isArray(stored) ? stored : []).map((at) => (typeof at === "string" ? toStopAt(departureAt, date, at) : null));
  const sequence = inputs.routeTypes.includes(routeType) ? inputs.sequences[routeType] : undefined;
  const served = inputs.estimates.get(runId);
  const shownAts = toEstimatedAts({ departureAt, storedAts, sequence }, served);
  const latestAts = toEstimatedAts({ departureAt, storedAts, sequence }, inputs.latestEstimates?.get(runId));
  const isEstimatedStop = (index: number) => sequence?.[index]?.timing === "estimated";
  const stopTimes = storedAts.map((at, index) => ({
    shownAt: shownAts && isEstimatedStop(index) ? (shownAts[index] ?? null) : at,
    isEstimated: shownAts !== null && isEstimatedStop(index),
    latestEstimateAt: latestAts && isEstimatedStop(index) ? (latestAts[index] ?? null) : null,
  }));
  return { runId, routeType, date, departureAt, isLastOfDay, stopTimes, estimate: shownAts && served ? { source: served.source, updatedAt: served.updatedAt } : null };
}

/** WHY: one run per entry of a day, in the entry's place, null for an entry with no route type or departure; the day's last run of a route type is its last bus. */
export function toDayRuns(serviceId: string, { date, schedule: entries }: Pick<ScheduleDay, "date" | "schedule">, inputs: EstimateInputs): Array<ShuttleRun | null> {
  const lastDepartureOf = (routeType: string) => entries.flatMap((entry) => (entry.routeType === routeType && typeof entry.time === "string" ? [entry.time] : [])).sort().at(-1);
  return entries.map(({ routeType, time, stopTimes }) => {
    if (typeof routeType !== "string" || typeof time !== "string") return null;
    return toRun({ runId: runKey({ serviceId, routeType, date, time }), routeType, date, time, stopTimes }, time === lastDepartureOf(routeType), inputs);
  });
}

const toTimetableTime = (at: Date): string => moment(at).tz(KST_TIME_ZONE).format("HH:mm");

// WHY: returns a copy, since the schedule cache keeps entry arrays by reference; only the estimated slots of a run with a
// served estimate change, and every other entry is the stored one itself.
function withRunTimes(entry: ScheduleEntry, run: ShuttleRun | null): ScheduleEntry {
  if (!run?.estimate || !Array.isArray(entry.stopTimes)) return entry;
  return {
    ...entry,
    stopTimes: entry.stopTimes.map((stored, index) => {
      const stopTime = run.stopTimes[index];
      return stopTime?.isEstimated && stopTime.shownAt ? toTimetableTime(stopTime.shownAt) : stored;
    }),
    eta: { source: run.estimate.source, updatedAt: run.estimate.updatedAt.toISOString() },
  };
}

/** WHY: the smart view's days as runs, then formatted back as the timetable's "HH:mm", the served estimates applied. */
export function applyEstimates(result: SmartSchedule, inputs: EstimateInputs): SmartSchedule {
  return {
    ...result,
    days: result.days.map((day) => {
      const runs = toDayRuns(result.serviceId, day, inputs);
      return { ...day, schedule: day.schedule.map((entry, index) => withRunTimes(entry, runs[index] ?? null)) };
    }),
  };
}

/** WHY: a status other than active carries its reason, in the request language. */
export function withStatusMessage(result: SmartSchedule, lang: SupportedLang): SmartSchedule {
  return result.status === "active" ? { ...result } : { ...result, message: t(`schedule.${result.status}`, lang) };
}
