import { Controller, Get, Res } from "@nestjs/common";
import type { Response } from "express";
import type { MapOverlays } from "../map.wire";
import { DEGRADED_TRANSIT_CACHE_CONTROL, TRANSIT_CACHE_CONTROL } from "./map-transit.constants";
import { MapTransitService } from "./map-transit.service";

@Controller("map/overlays")
export class MapTransitController {
  constructor(private readonly transit: MapTransitService) {}

  // WHY: Cache-Control depends on the answer, which @CacheControl cannot express; `degraded` stays off the wire.
  @Get("transit")
  async transitOverlays(@Res({ passthrough: true }) res: Response): Promise<MapOverlays> {
    const { overlays, degraded } = await this.transit.getTransitOverlays();
    res.setHeader("Cache-Control", degraded ? DEGRADED_TRANSIT_CACHE_CONTROL : TRANSIT_CACHE_CONTROL);
    return { overlays };
  }
}
