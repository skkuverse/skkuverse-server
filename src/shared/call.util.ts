import type { StopCall } from "./call.types";
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
