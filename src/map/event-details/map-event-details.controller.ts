import { Controller, Get } from "@nestjs/common";
import { CacheControl } from "../../http/cache-control.decorator";
import { EVENT_CACHE_CONTROL } from "../map.constants";
import { MapEventDetailsService } from "./map-event-details.service";
import type { EventPlaceDetails } from "./map-event-details.wire";

// WHY: its own route, read by the sheet alone, so drawing pins never downloads every menu; same minute as the pins.
@Controller("map/overlays")
export class MapEventDetailsController {
  constructor(private readonly details: MapEventDetailsService) {}

  @Get("event/details")
  @CacheControl(EVENT_CACHE_CONTROL)
  getEventPlaceDetails(): Promise<EventPlaceDetails> {
    return this.details.getEventPlaceDetails();
  }
}
