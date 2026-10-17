import type { HsscBusDoc, JongroArrivalDoc, JongroBusPositionDoc } from "../../cache/bus-cache.document";
import type { RegistryRoute } from "../../registry/bus-registry.types";
import type { StationEta } from "./bus-realtime-group.wire";

/** WHY: what a served bus reads from a cached HSSC bus or Jongro position; an HSSC bus has no coordinates. */
export type CachedBusFields = Pick<HsscBusDoc | JongroBusPositionDoc, "sequence" | "carNumber" | "estimatedTime"> &
  Partial<Pick<JongroBusPositionDoc, "latitude" | "longitude">>;

export type CachedArrivalFields = Pick<JongroArrivalDoc, "stationId" | "sequence" | "stationName" | "eta">;

export type JongroRouteStations = Pick<RegistryRoute, "mapping" | "topisIds">;

/** WHY: a row placed on its station, before its arrivals are added. */
export type PlacedStationEta = Pick<StationEta, "stationIndex" | "eta">;

/** WHY: what one group serves before the clock and the bus count are added. */
export interface GroupView {
  buses: readonly CachedBusFields[] | undefined;
  stationEtas: StationEta[];
  stationsVersion?: string;
}
