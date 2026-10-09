/**
 * The runs to estimate, read from the resolved timetable, so an override, an
 * SKKU rest day, a public holiday or a suspension removes a run here exactly
 * as it removes it from the schedule riders see — and no directions call is
 * made for a bus that does not run.
 */
import moment from "moment-timezone";
import type { DayResolution, ScheduleService } from "../schedule/schedule.service";

const TZ = "Asia/Seoul";

/** One bus departure of an opted-in sequence. */
export interface EtaRun {
  serviceId: string;
  routeType: string;
  date: string; // YYYY-MM-DD, KST
  time: string; // HH:mm, the departure from the first stop
  departAt: Date;
}

interface ScheduleEntry {
  time?: unknown;
  routeType?: unknown;
  stopTimes?: unknown;
}

/**
 * A resolved day's runs of one route type. An entry counts only when its
 * `stopTimes` has one item per sequence stop: an entry without them (an old
 * override) has no slot for an estimate. Two entries at the same time are one
 * run — the estimate is a travel time, the same for every bus that leaves then.
 */
export function runsOfDay(serviceId: string, day: DayResolution, routeType: string, sequenceLength: number): EtaRun[] {
  if (day.display !== "schedule") return [];
  const runs: EtaRun[] = [];
  const seen = new Set<string>();
  for (const raw of day.schedule as ScheduleEntry[]) {
    if (raw.routeType !== routeType || typeof raw.time !== "string") continue;
    if (!Array.isArray(raw.stopTimes) || raw.stopTimes.length !== sequenceLength) continue;
    if (seen.has(raw.time)) continue;
    seen.add(raw.time);
    runs.push({
      serviceId,
      routeType,
      date: day.date,
      time: raw.time,
      departAt: moment.tz(`${day.date} ${raw.time}`, "YYYY-MM-DD HH:mm", TZ).toDate(),
    });
  }
  return runs;
}

/** The runs of one KST date. */
export async function runsOn(
  schedule: ScheduleService,
  serviceId: string,
  routeType: string,
  sequenceLength: number,
  date: string,
): Promise<EtaRun[]> {
  const week = await schedule.resolveWeek(serviceId, date);
  const day = week?.days.find((d) => d.date === date);
  return day ? runsOfDay(serviceId, day, routeType, sequenceLength) : [];
}

/** Every run the smart view shows that has not departed by `now`. */
export async function upcomingRuns(
  schedule: ScheduleService,
  serviceId: string,
  routeType: string,
  sequenceLength: number,
  now: Date,
): Promise<EtaRun[]> {
  const smart = await schedule.resolveSmartSchedule(serviceId);
  if (!smart || smart.status !== "active") return [];
  return smart.days
    .flatMap((day) => runsOfDay(serviceId, day, routeType, sequenceLength))
    .filter((run) => run.departAt.getTime() > now.getTime());
}
