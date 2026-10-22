import type { HsscBusDoc, JongroArrivalBus, JongroArrivalDoc, JongroBusPositionDoc } from "../../cache/bus-cache.document";
import type { RegistryRoute } from "../../registry/bus-registry.types";
import type { Arrival, RealtimeBus, StationEta, TrackedStatus } from "./bus-realtime-group.wire";

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
  crowding: Arrival["crowding"];
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
  arrival: Pick<Arrival, "state" | "crowding" | "isLastBus"> | undefined;
  /** WHY: the highest sectOrd an arrival row gives the vehicle; absent when no row names it. */
  highestSectOrd?: number;
  /** WHY: every arrival row's bus naming the vehicle, by staOrd, which its trajectory's next stops come from. */
  namedBuses: readonly NextStopBus[];
}


/** WHY: what decides a tracked status beyond the position: the route's terminals and the vehicle's arrival rows. */
export type StatusContext = Pick<TrackingContext, "stationCount" | "turnaroundTopisId" | "highestSectOrd"> & { nextStopState: string | undefined };
