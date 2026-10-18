import type { RoutePath } from "../../bus/route-path/bus-route-path.types";
import type { MapOverlay } from "../map.wire";
import { ROUTE_LAYER_SUFFIX, ROUTE_NAME_PREFIX } from "./map-transit.constants";

// WHY: the line is served as stored, unclosed: the map draws a stored geometry as it is (map-architecture invariants).
function toRouteOverlay(routePath: RoutePath, order: number): MapOverlay {
  return {
    kind: "path",
    id: routePath.routeId,
    layerId: `${routePath.routeId}${ROUTE_LAYER_SUFFIX}`,
    campus: "hssc",
    text: { ko: `${ROUTE_NAME_PREFIX.ko}${routePath.code}`, en: `${ROUTE_NAME_PREFIX.en}${routePath.code}`, zh: `${ROUTE_NAME_PREFIX.zh}${routePath.code}` },
    subtitle: null,
    hours: [],
    fields: [],
    actions: [],
    order,
    facets: {},
    orderByOption: {},
    tap: null,
    geometry: { type: "LineString", coordinates: routePath.path },
  };
}

export function toTransitOverlays(routePaths: readonly RoutePath[]): MapOverlay[] {
  return routePaths.map(toRouteOverlay);
}
