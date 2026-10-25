import type { StopCall } from "../../../shared/call.types";
import type { Call } from "../../../shared/call.wire";
import type { VehiclePosition } from "../../bus.wire";
import type { RealtimeArrival, TrackedStatus } from "../../realtime/group/bus-realtime-group.wire";

// WHY: TOPIS's states as live statuses (ADR 0019, D1); its end-of-service and no-information texts are the station's operation instead,
// and a running bus with no time anywhere is unknown (ADR 0019, D1).
export const STATUS_BY_STATE: Readonly<Record<RealtimeArrival["state"], Call["status"] | null>> = {
  running: "enRoute",
  arriving: "arriving",
  waiting: "waitingToDepart",
  unknown: "unknown",
  ended: null,
  noInfo: null,
};

export const POSITION_STATUS_BY_TRACKED_STATUS: Readonly<Record<TrackedStatus["status"], VehiclePosition["status"]>> = {
  running: "inTransit",
  atStop: "atStop",
  waiting: "waitingToDepart",
};

// WHY: a bus standing at the station, arriving and 0 stops away until it leaves, with no instant: no departure countdown (ADR 0019, D14).
export const STANDING_CALL: Readonly<Omit<StopCall, "vehicleId" | "isLastRun" | "providerText">> = {
  status: "arriving",
  ...{ expectedArrivalAt: null, expectedDepartureAt: null, scheduledArrivalAt: null, scheduledDepartureAt: null },
  basis: "provider",
  stopsAway: 0,
  ...{ runId: null, headsign: null, isFirstRun: null, isExpress: null },
};
