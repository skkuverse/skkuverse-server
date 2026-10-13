import { Injectable } from "@nestjs/common";
import { createCachedLoader } from "../../infra/cached-loader";
import logger from "../../infra/logger";
import type { EventMapConfig } from "../layer-set/map-layer-set.schema";
import { MapLayerSetService } from "../layer-set/map-layer-set.service";
import { EVENT_CACHE_TTL_MS, EVENT_STALE_WINDOW_MS } from "../map.constants";
import type { SheetPlaceDoc } from "../map.document";
import { MapRepository } from "../map.repository";
import { presentationFor } from "../map.rules";
import { toPlaceDetail } from "./map-event-details.mapper";
import type { EventPlaceDetails, PlaceDetail } from "./map-event-details.wire";

// WHY: only a place the overlay route serves, on a category whose tap opens a place, has a sheet to open.
function sheetlessReason(doc: SheetPlaceDoc, config: EventMapConfig): string | null {
  const presentation = presentationFor(config, doc.category);
  if (!presentation.interactive) return `${doc._id}: category "${doc.category}" is not tappable`;
  return presentation.tapChip ? `${doc._id}: category "${doc.category}" taps to chip "${presentation.tapChip}"` : null;
}

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
    const config = await this.layerSet.activeEvent();
    if (!config) return { details: {} };
    const dropped: string[] = [];
    const details: Record<string, PlaceDetail> = {};
    for (const doc of await this.repository.listPlacesWithDetailByLayerSetId(config.layerSetId)) {
      const reason = sheetlessReason(doc, config);
      const detail = reason === null ? toPlaceDetail(doc, dropped) : (dropped.push(reason), null);
      if (detail) details[doc._id] = detail;
    }
    if (dropped.length > 0) {
      logger.warn(
        { event: "map.event_details.items_dropped", layerSetId: config.layerSetId, count: dropped.length, dropped },
        "Place-detail items dropped",
      );
    }
    return { details };
  }
}
