import type { RoutePath } from "../../bus/route-path/bus-route-path.types";
import type { Position } from "../../shared/geojson.types";
import { t } from "../../infra/i18n";
import type { MapOverlay } from "../map.wire";
import { HSSC_ROUTE_ID, HSSC_ROUTE_NAME_KEY, ROUTE_LAYER_SUFFIX, ROUTE_NAME_PREFIX } from "./map-transit.constants";

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

// WHY: the loop is served as stored, closed, on its own layer, named as /bus/config names the line.
export function toHsscRouteOverlay(path: Position[], order: number): MapOverlay {
  return {
    kind: "path",
    id: HSSC_ROUTE_ID,
    layerId: `${HSSC_ROUTE_ID}${ROUTE_LAYER_SUFFIX}`,
    campus: "hssc",
    text: { ko: t(HSSC_ROUTE_NAME_KEY, "ko"), en: t(HSSC_ROUTE_NAME_KEY, "en"), zh: t(HSSC_ROUTE_NAME_KEY, "zh") },
    subtitle: null,
    hours: [],
    fields: [],
    actions: [],
    order,
    facets: {},
    orderByOption: {},
    tap: null,
    geometry: { type: "LineString", coordinates: path },
  };
}
