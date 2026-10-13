import { Injectable } from "@nestjs/common";
import { createCachedLoader } from "../../infra/cached-loader";
import logger from "../../infra/logger";
import { MapLayerSetService } from "../layer-set/map-layer-set.service";
import { EVENT_CACHE_TTL_MS, EVENT_STALE_WINDOW_MS } from "../map.constants";
import { MapRepository } from "../map.repository";
import { toPlaceSheet } from "./map-event-details.mapper";
import { sheetlessReason } from "./map-event-details.rules";
import type { EventPlaceDetails, PlaceSheet } from "./map-event-details.wire";

@Injectable()
export class MapEventDetailsService {
  // WHY: cached whole, like the overlays it pairs with, on the same TTL.
  private readonly detailsCache = createCachedLoader({
    name: "event place details",
    ttlMs: EVENT_CACHE_TTL_MS,
    staleWindowMs: EVENT_STALE_WINDOW_MS,
    load: () => this.loadEventPlaceDetails(),
  });

  constructor(
    private readonly repository: MapRepository,
    private readonly layerSet: MapLayerSetService,
  ) {}

  getEventPlaceDetails(): Promise<EventPlaceDetails> {
    return this.detailsCache.get();
  }

  private async loadEventPlaceDetails(): Promise<EventPlaceDetails> {
    const liveLayerSet = await this.layerSet.liveLayerSet();
    if (!liveLayerSet) return { details: {} };
    const dropped: string[] = [];
    const details: Record<string, PlaceSheet> = {};
    for (const doc of await this.repository.listPlacesWithDetailByLayerSetId(liveLayerSet.layerSetId)) {
      const reason = sheetlessReason(doc, liveLayerSet);
      if (reason !== null) {
        dropped.push(reason);
        continue;
      }
      const detail = toPlaceSheet(doc, dropped);
      if (detail) details[doc._id] = detail;
    }
    if (dropped.length > 0) {
      logger.warn(
        { event: "map.event_details.items_dropped", layerSetId: liveLayerSet.layerSetId, count: dropped.length, dropped },
        "Place-detail items dropped",
      );
    }
    return { details };
  }
}
