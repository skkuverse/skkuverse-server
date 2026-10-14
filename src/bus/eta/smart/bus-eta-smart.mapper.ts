import { t } from "../../../infra/i18n";
import type { SupportedLang } from "../../../infra/types";
import type { ScheduleEntry, SmartSchedule } from "../../schedule/bus-schedule.wire";
import { runKey } from "./bus-eta-smart.rules";
import type { EstimateInputs } from "./bus-eta-smart.types";

/** WHY: "10:00" plus 3,060 s is "10:51": rounded to the minute, as the timetable shows times. */
function addSeconds(time: string, seconds: number): string {
  const [hours, minutes] = time.split(":");
  const total = (Number(hours) * 60 + Number(minutes) + Math.round(seconds / 60)) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// WHY: returns a copy, since the schedule cache keeps entry arrays by reference; only the estimated slots of an
// entry's `stopTimes` change, and an entry whose route type, stopTimes or offsets do not fit is left as stored.
export function applyEstimates(result: SmartSchedule, { routeTypes, sequences, estimates }: EstimateInputs): SmartSchedule {
  return {
    ...result,
    days: result.days.map((day) => ({
      ...day,
      schedule: day.schedule.map((entry): ScheduleEntry => {
        if (typeof entry.routeType !== "string" || typeof entry.time !== "string") return entry;
        const seq = routeTypes.includes(entry.routeType) ? sequences[entry.routeType] : undefined;
        if (!seq || !Array.isArray(entry.stopTimes) || entry.stopTimes.length !== seq.length) return entry;
        const est = estimates.get(runKey({ serviceId: result.serviceId, routeType: entry.routeType, date: day.date, time: entry.time }));
        if (!est || est.offsetsSec.length !== seq.length) return entry;
        const time = entry.time;
        return {
          ...entry,
          stopTimes: (entry.stopTimes as Array<string | null>).map((stored, index) => {
            const offset = est.offsetsSec[index];
            return seq[index]?.timing === "estimated" && offset !== undefined ? addSeconds(time, offset) : stored;
          }),
          eta: { source: est.source, updatedAt: est.updatedAt.toISOString() },
        };
      }),
    })),
  };
}

/** WHY: a status other than active carries its reason, in the request language. */
export function withStatusMessage(result: SmartSchedule, lang: SupportedLang): SmartSchedule {
  return result.status === "active" ? { ...result } : { ...result, message: t(`schedule.${result.status}`, lang) };
}
