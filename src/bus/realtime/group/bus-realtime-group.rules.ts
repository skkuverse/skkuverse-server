import type { JongroArrivalDoc, JongroBusPositionDoc } from "../../cache/bus-cache.document";
import { DWELL_SECONDS, MIN_SEGMENT_SECONDS, TRAJECTORY_STOPS_AHEAD } from "./bus-realtime-group.constants";
import type { Arrival, RealtimeBus } from "./bus-realtime-group.wire";
import type {
  CachedArrivalFields,
  StatusContext,
  JongroBusTracking,
  JongroRouteStations,
  NextStopBus,
  PlacedStationEta,
  TrackingContext,
  TrajectoryKnot,
  VehicleBuses,
} from "./bus-realtime-group.types";

function toStationEta(route: JongroRouteStations, arrival: CachedArrivalFields): PlacedStationEta | null {
  if (!arrival.eta) return null;
  const ordIndex = parseInt(arrival.sequence, 10) - 1;
  if (route.topisIds[ordIndex] === arrival.stationId) return { stationIndex: ordIndex, eta: arrival.eta };
  const station = route.mapping[arrival.stationId];
  return station ? { stationIndex: station.sequence - 1, eta: arrival.eta } : null;
}

// QUIRK(topis): a row is placed by its ord, confirmed by the stop ID there, since a loop lists its terminal
// twice (02: ord 1 departing, ord 27 arriving); a reordered stop falls back to its ID. Names never match:
// TOPIS renames stops without notice, and loops pass same-named stops twice.
export function toStationEtas(route: JongroRouteStations, arrivals: readonly CachedArrivalFields[] | undefined): PlacedStationEta[] {
  return (arrivals ?? [])
    .map((arrival) => toStationEta(route, arrival))
    .filter((eta): eta is PlacedStationEta => eta !== null);
}

export function toNamedBuses(rows: readonly Pick<JongroArrivalDoc, "eventDate" | "buses">[], vehicleId: string): NextStopBus[] {
  return rows
    .flatMap((row) => row.buses.filter((bus) => bus.vehId === vehicleId).map((bus) => ({ bus, madeAt: row.eventDate })))
    .sort((a, b) => a.bus.staOrd - b.bus.staOrd);
}

export function toVehicleBuses(rows: readonly Pick<JongroArrivalDoc, "eventDate" | "buses">[], vehicleId: string, sectOrd: number): VehicleBuses {
  const named = toNamedBuses(rows, vehicleId);
  return { nextStop: named.find(({ bus }) => bus.staOrd === sectOrd + 1), firstNamed: named[0]?.bus };
}

export function toHighestSectOrd(rows: readonly Pick<JongroArrivalDoc, "buses">[], vehicleId: string): number | undefined {
  const sectOrds = rows.flatMap((row) => row.buses.filter((bus) => bus.vehId === vehicleId).map((bus) => bus.sectOrd));
  return sectOrds.length > 0 ? Math.max(...sectOrds) : undefined;
}

// EVIDENCE: the arrival API counts the section toward the next stop, one past the position's sectOrd in 966 of
// 1,032 same-moment pairs (2026-10-17 capture); two past means the position is a section stale.
const MIN_LAGGING_SECTION_GAP = 2;

export function isLaggingPosition(position: Pick<JongroBusPositionDoc, "sequence">, highestSectOrd: number | undefined): boolean {
  return highestSectOrd !== undefined && highestSectOrd - Number(position.sequence) >= MIN_LAGGING_SECTION_GAP;
}

// WHY: an idling bus at a terminal reports stopFlag 0, so standing still there is waiting (add-jongro-bus-positions
// D4); the last index is a terminal (route 02's is its origin's stop again) and never running.
export function toTrackedStatus(
  position: JongroBusPositionDoc,
  { stationCount, turnaroundTopisId, nextStopState, highestSectOrd }: StatusContext,
): JongroBusTracking["status"] {
  if (isLaggingPosition(position, highestSectOrd)) return "running";
  const stationIndex = Number(position.sequence) - 1;
  const isLastIndex = stationIndex >= stationCount - 1;
  const isAtTerminal = stationIndex === 0 || isLastIndex || position.stationId === turnaroundTopisId;
  if ((position.isStationary && isAtTerminal) || nextStopState === "waiting") return "waiting";
  return position.isAtStop || isLastIndex ? "atStop" : "running";
}

export function toProgress(sectDist: number, fullSectDist: number): number {
  return fullSectDist > 0 ? Math.min(1, Math.max(0, sectDist / fullSectDist)) : 0;
}

// QUIRK(topis): mkTm is a KST wall clock, "yyyy-MM-dd HH:mm:ss.S", with no offset.
function toMadeAtMs(mkTm: string): number | null {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.\d+)?$/.exec(mkTm.trim());
  return match ? Date.parse(`${match[1]}T${match[2]}+09:00`) : null;
}

// WHY: traTime counts from when TOPIS made the row, and the bus was observed at another moment.
export function toNextStopInSec(nextStop: NextStopBus | undefined, observedAt: string): number | null {
  const madeAtMs = nextStop ? toMadeAtMs(nextStop.madeAt) : null;
  if (!nextStop || madeAtMs === null) return null;
  return Math.max(0, Math.round(nextStop.bus.traTime - (Date.parse(observedAt) - madeAtMs) / 1000));
}

function toDepartureMs({ atStopSince }: Pick<JongroBusPositionDoc, "atStopSince">, observedAtMs: number): number {
  const dwelledSeconds = atStopSince ? Math.max(0, (observedAtMs - Date.parse(atStopSince)) / 1000) : 0;
  return observedAtMs + Math.max(0, DWELL_SECONDS - dwelledSeconds) * 1000;
}

// WHY: the knots the app moves a bus through (add-jongro-bus-trajectory D2): its observation, an atStop bus's departure,
// then each next stop at its re-based travel time, MIN_SEGMENT_SECONDS after the knot before, since TOPIS's can invert.
export function toTrajectory(position: JongroBusPositionDoc, status: JongroBusTracking["status"], { stationCount, namedBuses }: Pick<TrackingContext, "stationCount" | "namedBuses">): TrajectoryKnot[] {
  if (status === "waiting") return [];
  const stationIndex = Number(position.sequence) - 1;
  const observedAtMs = Date.parse(position.observedAt);
  const progress = status === "running" ? toProgress(position.sectDist, position.fullSectDist) : 0;
  const knots: TrajectoryKnot[] = [{ atMs: observedAtMs, s: stationIndex + progress }];
  const lastIndex = stationCount - 1;
  if (stationIndex >= lastIndex) return knots;
  const departureMs = status === "atStop" ? toDepartureMs(position, observedAtMs) : observedAtMs;
  if (departureMs > observedAtMs) knots.push({ atMs: departureMs, s: stationIndex });
  let previousMs = departureMs;
  for (let index = stationIndex + 1; index <= Math.min(stationIndex + TRAJECTORY_STOPS_AHEAD, lastIndex); index++) {
    const inSec = toNextStopInSec(namedBuses.find(({ bus }) => bus.staOrd === index + 1), position.observedAt);
    if (inSec === null) break;
    previousMs = Math.max(observedAtMs + inSec * 1000, previousMs + MIN_SEGMENT_SECONDS * 1000);
    knots.push({ atMs: previousMs, s: index });
  }
  return knots;
}

export function toJongroBusTracking(position: JongroBusPositionDoc, context: TrackingContext): JongroBusTracking {
  const status = toTrackedStatus(position, { ...context, nextStopState: context.nextStop ? context.arrival?.state : undefined });
  const isRunning = status === "running";
  return {
    status,
    vehicleId: position.vehicleId,
    observedAt: position.observedAt,
    crowding: context.arrival?.crowding ?? null,
    isLastBus: context.arrival?.isLastBus ?? false,
    progress: isRunning ? toProgress(position.sectDist, position.fullSectDist) : 0,
    segmentMeters: Math.round(position.fullSectDist * 1000),
    nextStopInSec: isRunning ? toNextStopInSec(context.nextStop, position.observedAt) : null,
    trajectory: toTrajectory(position, status, context),
  };
}

// WHY: TOPIS prints its arriving-soon text at the next stop for a bus idling at its origin
// (add-jongro-bus-positions D7), so a waiting vehicle's arrivals follow its joined position.
export function toWaitingArrival(arrival: Arrival): Arrival {
  return { ...arrival, state: "waiting", minutes: null };
}

export function toWaitingVehicleIds(buses: readonly RealtimeBus[]): Set<string> {
  return new Set(buses.flatMap((bus) => (bus.kind === "tracked" && bus.tracked.status === "waiting" ? [bus.tracked.vehicleId] : [])));
}
