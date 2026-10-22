import type { HsscBusDoc, JongroArrivalBus, JongroArrivalDoc, JongroBusPositionDoc } from "../../cache/bus-cache.document";
import type { RegistryRoute } from "../../registry/bus-registry.types";
import type { TimedArrival } from "../arrival/bus-realtime-arrival.types";
import type { RealtimeArrival, RealtimeBus, StationEta, TrackedStatus } from "./bus-realtime-group.wire";

/** WHY: what a served bus reads from a cached HSSC bus or Jongro position; an HSSC bus has no coordinates. */
export type CachedBusFields = Pick<HsscBusDoc | JongroBusPositionDoc, "sequence" | "carNumber" | "estimatedTime"> &
  Partial<Pick<JongroBusPositionDoc, "latitude" | "longitude">>;

export type CachedArrivalFields = Pick<JongroArrivalDoc, "stationId" | "sequence" | "stationName" | "eta">;

export type JongroRouteStations = Pick<RegistryRoute, "mapping" | "topisIds">;

/** WHY: a row placed on its station, before its arrivals are added. */
export type PlacedStationEta = Pick<StationEta, "stationIndex" | "eta">;

/** WHY: what one group serves before the clock and the bus count are added. */
export interface GroupView {
  buses: RealtimeBus[];
  stationEtas: StationEta[];
  stationsVersion?: string;
}

/** WHY: what a tracked bus is doing, before the wire assembles it. */
export interface JongroBusTracking {
  status: TrackedStatus["status"];
  vehicleId: string;
  observedAt: string;
  crowding: RealtimeArrival["crowding"];
  isLastBus: boolean;
  progress: number;
  segmentMeters: number;
  nextStopInSec: number | null;
  trajectory: TrajectoryKnot[];
}

/** WHY: a point a tracked bus passes: s is its station index plus the fraction of the section toward the next. */
export interface TrajectoryKnot {
  atMs: number;
  s: number;
}

/** WHY: a vehicle's bus on the arrival row of its next stop, with when TOPIS made that row (mkTm). */
export interface NextStopBus {
  bus: JongroArrivalBus;
  madeAt: string;
}

/** WHY: the arrival rows that name a vehicle: its next stop's, and the first in station order. */
export interface VehicleBuses {
  nextStop: NextStopBus | undefined;
  firstNamed: JongroArrivalBus | undefined;
}

/** WHY: what decides a tracked bus beyond its position: its route's stops and its next-stop row's reading. */
export interface TrackingContext {
  stationCount: number;
  turnaroundTopisId: string;
  nextStop: NextStopBus | undefined;
  arrival: Pick<RealtimeArrival, "state" | "crowding" | "isLastBus"> | undefined;
  /** WHY: the highest sectOrd an arrival row gives the vehicle; absent when no row names it. */
  highestSectOrd?: number;
  /** WHY: every arrival row's bus naming the vehicle, by staOrd, which its trajectory's next stops come from. */
  namedBuses: readonly NextStopBus[];
}

/** WHY: what decides a tracked status beyond the position: the route's terminals and the vehicle's arrival rows. */
export type StatusContext = Pick<TrackingContext, "stationCount" | "turnaroundTopisId" | "highestSectOrd"> & { nextStopState: string | undefined };

/** WHY: an arrival row placed on its station, each slot read as the realtime view serves it, a waiting vehicle's waiting. */
export interface PlacedArrivalRow {
  stationIndex: number;
  /** QUIRK(topis): mkTm, when TOPIS made the row, which traTime counts from; null when malformed. */
  madeAtMs: number | null;
  slots: TimedArrival[];
}

export interface TrackedPosition {
  position: JongroBusPositionDoc;
  tracking: JongroBusTracking;
  /** WHY: when the poller last wrote the positions. */
  checkedAt: Date;
}

/** WHY: what the live route maps a Jongno group from: this view's reads and joins, with when each key was written. */
export interface JongroReading {
  route: RegistryRoute;
  rows: PlacedArrivalRow[];
  positions: TrackedPosition[];
  arrivalsCheckedAt: Date | null;
  positionsCheckedAt: Date | null;
}
