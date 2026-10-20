import type { JongroRouteAttributes } from "../bus.types";

export interface JongroRouteAttributesData {
  routes: Record<string, JongroRouteAttributes>;
}

export interface RouteAttributesIssue {
  path: Array<string | number>;
  message: string;
}

/** WHY: one revision of the stored attributes; `attributesOf` answers none for a route the revision lacks. */
export interface RouteAttributesSnapshot {
  revision: number;
  attributesOf(routeId: string): JongroRouteAttributes | undefined;
}
