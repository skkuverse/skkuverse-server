import type { JongroRouteAttributesData, RouteAttributesIssue } from "./bus-route-attributes.types";

export function toMissingRouteIds({ routes }: JongroRouteAttributesData, routeIds: readonly string[]): string[] {
  return routeIds.filter((routeId) => !Object.hasOwn(routes, routeId));
}

export function toUnknownRouteIds({ routes }: JongroRouteAttributesData, routeIds: readonly string[]): string[] {
  const served = new Set(routeIds);
  return Object.keys(routes).filter((routeId) => !served.has(routeId));
}

/** WHY: the stored attributes must name exactly the routes the checked-out code serves (spec "Attributes push checks every route"). */
export function toRouteAttributesIssues(attributes: JongroRouteAttributesData, routeIds: readonly string[]): RouteAttributesIssue[] {
  return [
    ...toMissingRouteIds(attributes, routeIds).map((routeId) => ({
      path: ["routes", routeId],
      message: `missing: the checked-out code serves "${routeId}", so it needs attributes`,
    })),
    ...toUnknownRouteIds(attributes, routeIds).map((routeId) => ({ path: ["routes", routeId], message: `"${routeId}" is not a route the checked-out code serves` })),
  ];
}
