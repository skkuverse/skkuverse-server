import { Injectable } from "@nestjs/common";
import { BusHsscRouteLineService } from "../../bus/hssc-route-line/bus-hssc-route-line.service";
import { BusRoutePathService } from "../../bus/route-path/bus-route-path.service";
import { toHsscRouteOverlay, toTransitOverlays } from "./map-transit.mapper";
import type { TransitOverlays } from "./map-transit.types";

@Injectable()
export class MapTransitService {
  constructor(
    private readonly routePaths: BusRoutePathService,
    private readonly hsscRouteLine: BusHsscRouteLineService,
  ) {}

  // WHY: with no HSSC line ever read the Jongno lines serve without it, cached briefly (ADR 0013, D6).
  async getTransitOverlays(): Promise<TransitOverlays> {
    const [{ routePaths, hasMissingRoutes }, hsscRouteLine] = await Promise.all([this.routePaths.listRoutePaths(), this.hsscRouteLine.findCurrent()]);
    const jongroOverlays = toTransitOverlays(routePaths);
    if (hsscRouteLine === null) return { overlays: jongroOverlays, degraded: true };
    return { overlays: [...jongroOverlays, toHsscRouteOverlay(hsscRouteLine.path, jongroOverlays.length)], degraded: hasMissingRoutes };
  }
}
