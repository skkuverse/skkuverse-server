import type { StopCall } from "../../shared/call.types";
import type { RunStopTime, ShuttleRun } from "../eta/smart/bus-eta-smart.types";
import type { ShuttleStopRoute } from "../stop-index/bus-stop-index.types";
import { t } from "../../infra/i18n";
import type { SupportedLang } from "../../infra/types";
import { HEADSIGN_KEY_BY_ROUTE_TYPE, NEXT_RUN_COUNT } from "./bus-stop-arrivals.constants";
import { toTimetableArrival } from "./bus-stop-arrivals.mapper";
import type { RunCall, TimetableArrival } from "./bus-stop-arrivals.types";

const MINUTE_MS = 60_000;

/** WHY: a direction-bearing route type says which way a run goes; any other keeps its service's label (ADR 0022, D2). */
export function toRunHeadsign(routeType: string, serviceLabel: string, lang: SupportedLang): string {
  const headsignKey = HEADSIGN_KEY_BY_ROUTE_TYPE[routeType];
  return headsignKey === undefined ? serviceLabel : t(headsignKey, lang);
}

type RunStop = Pick<ShuttleStopRoute, "routeType" | "sequenceIndex" | "action">;
type ListedCall = { listedAtMs: number; call: RunCall };

// WHY: a boarding stop fills the departure pair, an alighting stop the arrival pair; an estimate the smart view applied
// at an estimated stop is the expected one, beside the timetable's own time there, if any (ADR 0022, D2).
function toRunInstants({ shownAt, timetableAt }: RunStopTime, isEstimated: boolean, action: RunStop["action"]): Pick<StopCall, "expectedArrivalAt" | "expectedDepartureAt" | "scheduledArrivalAt" | "scheduledDepartureAt"> {
  const [expected, scheduled] = isEstimated ? [shownAt, timetableAt] : [null, shownAt];
  return action === "board"
    ? { expectedArrivalAt: null, expectedDepartureAt: expected, scheduledArrivalAt: null, scheduledDepartureAt: scheduled }
    : { expectedArrivalAt: expected, expectedDepartureAt: null, scheduledArrivalAt: scheduled, scheduledDepartureAt: null };
}

// WHY: where the stop shows no timetable time, the run's latest estimate, even one too old to serve, keeps it listed
// until it arrives, and never drops it before the served time it shows (ADR 0019, D12).
function toListedAtMs(departureAt: Date, { shownAt, isEstimated, latestEstimateAt }: RunStopTime): number {
  const shownAtMs = (shownAt ?? departureAt).getTime();
  const isTimetableTime = shownAt !== null && !isEstimated;
  return isTimetableTime || latestEstimateAt === null ? shownAtMs : Math.max(latestEstimateAt.getTime(), shownAtMs);
}

const NO_STOP_TIME: RunStopTime = { shownAt: null, isEstimated: false, latestEstimateAt: null, timetableAt: null };

function toListedCall(run: ShuttleRun, stop: RunStop): ListedCall {
  const stopTime = run.stopTimes[stop.sequenceIndex] ?? NO_STOP_TIME;
  const { shownAt } = stopTime;
  const isEstimated = shownAt !== null && stopTime.isEstimated;
  const call: RunCall = {
    status: "scheduled",
    ...toRunInstants(stopTime, isEstimated, stop.action),
    basis: isEstimated ? "estimate" : "timetable",
    ...{ stopsAway: null, runId: run.runId, vehicleId: null, headsign: null },
    ...{ isFirstRun: run.isFirstOfDay, isLastRun: run.isLastOfDay, isExpress: null, providerText: null },
    runDepartureAt: run.departureAt,
  };
  return { listedAtMs: toListedAtMs(run.departureAt, stopTime), call };
}

/**
 * WHY: the next runs of the stop's route type at one stop, each listed until its time here passes, where the stop
 * shows none the later of its latest estimate's arrival and the served estimate shown, else its departure; a run still
 * counts in its own minute, as the timetable gives minutes (ADR 0019, D12).
 */
export function toTimetableArrivals(runs: readonly ShuttleRun[], stop: RunStop, now: Date): TimetableArrival[] {
  const fromMs = Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS;
  return runs
    .filter(({ routeType }) => routeType === stop.routeType)
    .map((run) => toListedCall(run, stop))
    .filter(({ listedAtMs }) => listedAtMs >= fromMs)
    .sort((a, b) => a.listedAtMs - b.listedAtMs)
    .slice(0, NEXT_RUN_COUNT)
    .map(({ call }) => toTimetableArrival(call));
}
