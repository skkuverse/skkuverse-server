import type { CallInstantKey, CallSide, RunIdentity, StopCall, TimetabledStopTime } from "./call.types";
import type { Call } from "./call.wire";
import { toKstInstant } from "./kst-date.util";

const toServedInstant = (at: Date | null): string | null => (at === null ? null : toKstInstant(at.getTime()));

/** WHY: every key in the wire's own order, so every producer serves the same bytes for the same call (ADR 0022, D2, D6). */
export function toCall(stopCall: StopCall): Call {
  return {
    status: stopCall.status,
    expectedArrivalAt: toServedInstant(stopCall.expectedArrivalAt),
    expectedDepartureAt: toServedInstant(stopCall.expectedDepartureAt),
    scheduledArrivalAt: toServedInstant(stopCall.scheduledArrivalAt),
    scheduledDepartureAt: toServedInstant(stopCall.scheduledDepartureAt),
    basis: stopCall.basis,
    stopsAway: stopCall.stopsAway,
    runId: stopCall.runId,
    vehicleId: stopCall.vehicleId,
    headsign: stopCall.headsign,
    isFirstRun: stopCall.isFirstRun,
    isLastRun: stopCall.isLastRun,
    isExpress: stopCall.isExpress,
    providerText: stopCall.providerText,
  };
}

/** WHY: the one time a call is compared by, in the order ADR 0022 D2 fixes and clients read. */
export function toCallTime(call: Pick<StopCall, CallInstantKey>): Date | null {
  return call.expectedDepartureAt ?? call.scheduledDepartureAt ?? call.expectedArrivalAt ?? call.scheduledArrivalAt;
}

// WHY: an estimate shown at the stop is the expected time, beside the timetable's own there, if any (ADR 0022, D2).
export function toTimetabledCall({ shownAt, timetableAt, isEstimated }: TimetabledStopTime, side: CallSide, run: RunIdentity): StopCall {
  const isShownEstimate = shownAt !== null && isEstimated;
  const [expected, scheduled] = isShownEstimate ? [shownAt, timetableAt] : [null, shownAt];
  const departure = side === "board" ? { expected, scheduled } : { expected: null, scheduled: null };
  const arrival = side === "alight" ? { expected, scheduled } : { expected: null, scheduled: null };
  return {
    status: "scheduled",
    ...{ expectedArrivalAt: arrival.expected, expectedDepartureAt: departure.expected, scheduledArrivalAt: arrival.scheduled, scheduledDepartureAt: departure.scheduled },
    basis: isShownEstimate ? "estimate" : "timetable",
    ...{ stopsAway: null, runId: run.runId, vehicleId: null, headsign: run.headsign },
    ...{ isFirstRun: run.isFirstRun, isLastRun: run.isLastRun, isExpress: null, providerText: null },
  };
}
