import type { Position } from "../../shared/geojson.types";
import type { RoutePathStation } from "./bus-route-path.document";

export interface FetchedRoutePath {
  path: Position[];
  stations: RoutePathStation[];
}

export interface RoutePath extends FetchedRoutePath {
  routeId: string;
  /** WHY: the route's number as Seoul names it (`07`), which the map labels it with. */
  code: string;
}

export interface RoutePaths {
  routePaths: RoutePath[];
  /** WHY: a configured route has no stored line yet, so a client should not cache the answer long. */
  hasMissingRoutes: boolean;
}

export interface PathShape {
  pointCount: number;
  lengthMeters: number;
}

export type PathHoldReason = "tooFewPoints" | "noStations" | "pointCountChanged" | "lengthChanged";

export type PathSyncDecision = { kind: "unchanged" } | { kind: "hold"; reason: PathHoldReason } | { kind: "apply" };
