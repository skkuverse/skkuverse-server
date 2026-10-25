import type { StopCall } from "../../../shared/call.types";
import type { Call } from "../../../shared/call.wire";
import type { Departure } from "../../../shared/departure.types";
import type { Vehicle } from "../../../shared/vehicle.wire";
import type { LiveGroup } from "../../live/bus-live.wire";

export function toInstant(served: string | null): Date | null {
  return served === null ? null : new Date(served);
}

// WHY: the board reads the live route's own calls, whose instants are whole seconds, so toCall gives back the same call.
export function toStopCall(served: Call): StopCall {
  return {
    ...served,
    expectedArrivalAt: toInstant(served.expectedArrivalAt),
    expectedDepartureAt: toInstant(served.expectedDepartureAt),
    scheduledArrivalAt: toInstant(served.scheduledArrivalAt),
    scheduledDepartureAt: toInstant(served.scheduledDepartureAt),
  };
}

// WHY: TOPIS publishes each stop's first run; before it the board knows that run's time, not its vehicle.
export function toFirstRunCall(startsAt: Date, headsign: string | null): StopCall {
  return {
    status: "scheduled",
    ...{ expectedArrivalAt: null, expectedDepartureAt: null, scheduledArrivalAt: startsAt, scheduledDepartureAt: null },
    basis: "timetable",
    ...{ stopsAway: null, runId: null, vehicleId: null, headsign, isFirstRun: true, isLastRun: false, isExpress: null, providerText: null },
  };
}

/** WHY: the shared vehicle of each one the departures name; its plate and position stay the live route's (ADR 0022, D2). */
export function toBoardVehicles(vehicles: LiveGroup["vehicles"], departures: readonly Departure[]): Record<string, Vehicle> {
  const ids = new Set(departures.flatMap(({ board, alight }) => [board.vehicleId, alight?.vehicleId ?? null]));
  return Object.fromEntries(vehicles.filter(({ id }) => ids.has(id)).map(({ id, occupancy, seatsLeft, isLowFloor }) => [id, { id, occupancy, seatsLeft, isLowFloor }]));
}
