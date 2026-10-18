import { Injectable } from "@nestjs/common";
import { BusRoutePathService } from "../../bus/route-path/bus-route-path.service";
import { toTransitOverlays } from "./map-transit.mapper";
import type { TransitOverlays } from "./map-transit.types";

@Injectable()
export class MapTransitService {
  constructor(private readonly routePaths: BusRoutePathService) {}

  async getTransitOverlays(): Promise<TransitOverlays> {
    const { routePaths, isSeedFallback } = await this.routePaths.listRoutePaths();
    return { overlays: toTransitOverlays(routePaths), degraded: isSeedFallback };
  }
}
