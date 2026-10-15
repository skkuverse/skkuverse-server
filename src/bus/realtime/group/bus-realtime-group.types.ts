import type { HsscBusDoc, JongroArrivalDoc, JongroBusPositionDoc } from "../../cache/bus-cache.document";
import type { JongroRoute } from "../../bus.types";

/** WHY: what a served bus reads from a cached HSSC bus or Jongro position; an HSSC bus has no coordinates. */
export type CachedBusFields = Pick<HsscBusDoc | JongroBusPositionDoc, "sequence" | "carNumber" | "estimatedTime"> &
  Partial<Pick<JongroBusPositionDoc, "latitude" | "longitude">>;

export type CachedArrivalFields = Pick<JongroArrivalDoc, "stationId" | "sequence" | "stationName" | "eta">;

export type JongroRouteStops = Pick<JongroRoute, "mapping" | "topisIds">;
