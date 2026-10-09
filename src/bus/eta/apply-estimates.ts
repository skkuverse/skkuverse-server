import type { SmartScheduleResult } from "../schedule/schedule.service";
import type { SequenceStop } from "../types";
import { runKey, type ServedEstimate } from "./shuttle-eta.service";

interface Entry {
  time?: unknown;
  routeType?: unknown;
  stopTimes?: unknown;
  [k: string]: unknown;
}

/** "10:00" plus 3,060 s is "10:51": rounded to the minute, as the timetable shows times. */
function addSeconds(time: string, seconds: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = (h! * 60 + m! + Math.round(seconds / 60)) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * The smart schedule with estimates applied (design D12). Returns a copy: the
 * schedule cache keeps entry arrays by reference, and writing into them would
 * put one request's estimates into every later response.
 *
 * Only the estimated slots of an entry's `stopTimes` change, and the entry
 * gains `eta: { source, updatedAt }`. An entry is left as stored when its
 * route type is not opted in, its `stopTimes` do not fit the sequence, or the
 * estimate's offsets no longer do (the catalog changed after it was fetched).
 */
export function applyEstimates(
  result: SmartScheduleResult,
  routeTypes: readonly string[],
  sequences: Readonly<Record<string, readonly SequenceStop[]>>,
  estimates: ReadonlyMap<string, ServedEstimate>,
): SmartScheduleResult {
  return {
    ...result,
    days: result.days.map((day) => ({
      ...day,
      schedule: (day.schedule as Entry[]).map((entry) => {
        if (typeof entry.routeType !== "string" || typeof entry.time !== "string") return entry;
        const seq = routeTypes.includes(entry.routeType) ? sequences[entry.routeType] : undefined;
        if (!seq || !Array.isArray(entry.stopTimes) || entry.stopTimes.length !== seq.length) return entry;
        const est = estimates.get(runKey(result.serviceId, entry.routeType, day.date, entry.time));
        if (!est || est.offsetsSec.length !== seq.length) return entry;
        const time = entry.time;
        return {
          ...entry,
          stopTimes: (entry.stopTimes as Array<string | null>).map((stored, k) =>
            seq[k]!.timing === "estimated" ? addSeconds(time, est.offsetsSec[k]!) : stored,
          ),
          eta: { source: est.source, updatedAt: est.updatedAt.toISOString() },
        };
      }),
    })),
  };
}
