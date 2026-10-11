import { Controller, Get, Res } from "@nestjs/common";
import type { Response } from "express";
import type { MapOverlays } from "../map.wire";
import { CAMPUS_CACHE_CONTROL, DEGRADED_CACHE_CONTROL } from "./map-campus.constants";
import { MapCampusService } from "./map-campus.service";

@Controller("map/overlays")
export class MapCampusController {
  constructor(private readonly campus: MapCampusService) {}

  // WHY: Cache-Control depends on the answer, which @CacheControl cannot express; `degraded` stays off the wire.
  @Get("campus")
  async campusOverlays(@Res({ passthrough: true }) res: Response): Promise<MapOverlays> {
    const { overlays, degraded } = await this.campus.getCampusOverlays();
    res.setHeader("Cache-Control", degraded ? DEGRADED_CACHE_CONTROL : CAMPUS_CACHE_CONTROL);
    return { overlays };
  }
}
