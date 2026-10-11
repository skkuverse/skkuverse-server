import { Controller, Get } from "@nestjs/common";
import { CacheControl } from "../../http/cache-control.decorator";
import { EVENT_CACHE_CONTROL } from "../map.constants";
import type { MapOverlays } from "../map.wire";
import { MapEventService } from "./map-event.service";

@Controller("map/overlays")
export class MapEventController {
  constructor(private readonly event: MapEventService) {}

  @Get("event")
  @CacheControl(EVENT_CACHE_CONTROL)
  getEventOverlays(): Promise<MapOverlays> {
    return this.event.getEventOverlays();
  }
}
