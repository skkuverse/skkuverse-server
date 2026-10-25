import { toKstInstant } from "../../../shared/kst-date.util";
import type { StopCall } from "../../../shared/call.types";
import type { Vehicle, VehiclePosition } from "../../bus.wire";
import type { HsscEta } from "../../realtime/hssc-eta/bus-realtime-hssc-eta.types";
import type { HsscLiveBus } from "./bus-live-hssc.types";

type Knot = { atMs: number; s: number };

// WHY: a bus standing at its stop is arriving with no departure instant (ADR 0019, D14): the dwell median is no departure time.
function toExpectedArrivalAt(eta: HsscEta): Date | null {
  return eta.status === "enRoute" ? eta.arrivesAt : null;
}

/** WHY: the engine's estimate from its measured medians, never a provider's (ADR 0019, D1). */
export function toHsscCall(eta: HsscEta): StopCall {
  return {
    status: eta.status,
    expectedArrivalAt: toExpectedArrivalAt(eta),
    ...{ expectedDepartureAt: null, scheduledArrivalAt: null, scheduledDepartureAt: null },
    basis: "estimate",
    stopsAway: eta.stopsAway,
    runId: null,
    vehicleId: eta.vehicleId,
    ...{ headsign: null, isFirstRun: null, isLastRun: null, isExpress: null, providerText: null },
  };
}

// WHY: at a rotary pass the bus boards no one, so it is passing; a stalled bus stays where it was last seen (ADR 0018, D6).
export function toHsscPositionStatus({ anchor, isAtStopPosition, isLayingOver }: HsscLiveBus): VehiclePosition["status"] {
  if (isLayingOver) return "waitingToDepart";
  return !anchor.isDeparted && isAtStopPosition ? "atStop" : "inTransit";
}

// WHY: the lap runs on from the bus's station, so the k-th time ahead is s = stationIndex + k; the turnaround that ends
// the lap is past the last index, read mod the station count (ADR 0019, D7).
function toKnots({ anchor, stationIndex, departsAt, lapTimes }: HsscLiveBus): Knot[] {
  const knots: Knot[] = [{ atMs: anchor.since.getTime(), s: stationIndex }];
  if (departsAt) knots.push({ atMs: departsAt.getTime(), s: stationIndex });
  lapTimes.forEach((time, ahead) => {
    const position = stationIndex + ahead + 1;
    knots.push({ atMs: time.arrivesAt.getTime(), s: position });
    if (time.departsAt) knots.push({ atMs: time.departsAt.getTime(), s: position });
  });
  return knots;
}

/** WHY: the engine's stop instants, so an HSSC marker moves as a Jongno one does (ADR 0019, D7); none for a bus laying over or stalled. */
export function toHsscTrajectory(bus: HsscLiveBus): Vehicle["trajectory"] {
  if (bus.lapTimes.length === 0) return null;
  let previousMs = -Infinity;
  return toKnots(bus).map((knot) => {
    previousMs = Math.max(knot.atMs, previousMs);
    return { at: toKstInstant(previousMs), s: knot.s };
  });
}
