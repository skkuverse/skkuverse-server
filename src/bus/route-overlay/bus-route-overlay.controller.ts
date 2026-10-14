import { Controller, Get, Param } from "@nestjs/common";
import { AppError } from "../../http/app.error";
import { BusRouteOverlayService } from "./bus-route-overlay.service";
import type { RouteOverlay } from "./bus-route-overlay.wire";

@Controller("bus/route")
export class BusRouteOverlayController {
  constructor(private readonly routeOverlay: BusRouteOverlayService) {}

  @Get(":routeId")
  getRoute(@Param("routeId") routeId: string): RouteOverlay {
    const route = this.routeOverlay.getRoute(routeId);
    if (!route) throw new AppError("NOT_FOUND", `Route '${routeId}' not found`, 404);
    return route;
  }
}
