import type { LatLng } from "../../../shared/lat-lng.types";

export interface NaverDirectionsGuide {
  pointIndex: number;
  type: number;
  instructions?: string;
  distance: number;
  duration: number;
}

export interface NaverDirectionsResponse {
  code: number;
  message: string;
  route?: {
    traoptimal?: Array<{
      summary: { duration: number; distance: number; [k: string]: unknown };
      /** QUIRK(naver): [lng, lat]. */
      path: Array<[number, number]>;
      guide: NaverDirectionsGuide[];
      [k: string]: unknown;
    }>;
    [k: string]: unknown;
  };
}

export interface NaverCredentials {
  keyId: string;
  key: string;
}

/** WHY: a point a NAVER route passes in order: a stop is timed, a via only steers the route between stops. */
export type RoutePoint = { at: LatLng; kind: "stop" | "via" };

export interface RouteTimes {
  stopOffsetsSec: number[];
  legsSec: number[];
}

/** WHY: a route forced through the corridor ends: its stops' offsets, and the car time it gives the corridor itself. */
export interface CorridorRoute {
  stopOffsetsSec: number[];
  corridorCarSec: number;
}
