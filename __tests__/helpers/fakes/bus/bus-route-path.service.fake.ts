/**
 * Scripted BusRoutePathService for the map: `listRoutePaths` answers
 * `routePaths` (the stored lines, flagged when a route has none), or rejects
 * with `failWith`; `findRoutePath` answers the route of `routePaths` with that
 * id, or null; `sync` records the routes it was asked for.
 */
import type { JongroRoute } from "../../../../src/bus/bus.types";
import type { BusRoutePathService } from "../../../../src/bus/route-path/bus-route-path.service";
import type { RoutePath, RoutePaths } from "../../../../src/bus/route-path/bus-route-path.types";
import type { PublicOf } from "../public-of";

export class FakeBusRoutePathService implements PublicOf<BusRoutePathService> {
  routePaths: RoutePaths = { routePaths: [], hasMissingRoutes: false };
  failWith: Error | null = null;
  syncedRouteIds: string[] = [];

  async listRoutePaths(): Promise<RoutePaths> {
    if (this.failWith) throw this.failWith;
    return structuredClone(this.routePaths);
  }

  async findRoutePath(routeId: string): Promise<RoutePath | null> {
    if (this.failWith) throw this.failWith;
    return structuredClone(this.routePaths.routePaths.find((routePath) => routePath.routeId === routeId) ?? null);
  }

  async sync(route: JongroRoute): Promise<void> {
    this.syncedRouteIds.push(route.id);
  }
}
