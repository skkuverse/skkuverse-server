import type { CachedJongroArrivalDoc, HsscBusDoc, JongroBusPositionDoc } from "../../cache/bus-cache.document";
import type { JongroRoute } from "../../bus.types";
import type { StationEta } from "./bus-realtime-group.wire";

/** WHY: what a served bus reads from a cached HSSC bus or Jongro position; an HSSC bus has no coordinates. */
export type CachedBusFields = Pick<HsscBusDoc | JongroBusPositionDoc, "sequence" | "carNumber" | "estimatedTime"> &
  Partial<Pick<JongroBusPositionDoc, "latitude" | "longitude">>;

export type CachedArrivalFields = Pick<CachedJongroArrivalDoc, "stationId" | "sequence" | "stationName" | "eta">;

export type JongroRouteStations = Pick<JongroRoute, "mapping" | "topisIds">;

/** WHY: a row placed on its station, before its arrivals are added. */
export type PlacedStationEta = Pick<StationEta, "stationIndex" | "eta">;
