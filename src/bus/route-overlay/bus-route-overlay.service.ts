import { Injectable } from "@nestjs/common";
import { JONGRO02_COORDS, JONGRO07_COORDS, OVERLAY_COLOR } from "./bus-route-overlay.constants";
import type { RouteOverlay } from "./bus-route-overlay.wire";

@Injectable()
export class BusRouteOverlayService {
  private readonly routes = new Map<string, RouteOverlay>([
    ["jongro07", { color: OVERLAY_COLOR, coords: JONGRO07_COORDS }],
    ["jongro02", { color: OVERLAY_COLOR, coords: JONGRO02_COORDS }],
  ]);

  getRoute(routeId: string): RouteOverlay | undefined {
    return this.routes.get(routeId);
  }
}
