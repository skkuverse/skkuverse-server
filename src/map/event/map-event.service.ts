import { Injectable } from "@nestjs/common";
import { createCachedLoader } from "../../infra/cached-loader";
import logger from "../../infra/logger";
import { MiniAppsService } from "../../miniapps/miniapps.service";
import type { EventMapConfig } from "../layer-set/map-layer-set.schema";
import { MapLayerSetService } from "../layer-set/map-layer-set.service";
import { EVENT_CACHE_TTL_MS, EVENT_STALE_WINDOW_MS } from "../map.constants";
import type { MapPlaceDoc } from "../map.document";
import { MapRepository } from "../map.repository";
import { isRenderable } from "../map.rules";
import type { MapOverlays } from "../map.wire";
import { toEventOverlay } from "./map-event.mapper";
import type { EventDrops } from "./map-event.types";

@Injectable()
export class MapEventService {
  // WHY: the whole projection is cached: every client asks for the same body, so the scan runs once per TTL per replica.
  private readonly overlaysCache = createCachedLoader({
    name: "event overlays",
    ttlMs: EVENT_CACHE_TTL_MS,
    staleWindowMs: EVENT_STALE_WINDOW_MS,
    load: () => this.loadEventOverlays(),
  });

  constructor(
    private readonly repository: MapRepository,
    private readonly layerSet: MapLayerSetService,
    private readonly miniApps: MiniAppsService,
  ) {}

  /** WHY: empty, not an error, when no festival is live: the app asks whenever the layer is configured. */
  getEventOverlays(): Promise<MapOverlays> {
    return this.overlaysCache.get();
  }

  private async loadEventOverlays(): Promise<MapOverlays> {
    const config = await this.layerSet.activeEvent();
    if (!config) return { overlays: [] };
    const places = await this.renderablePlaces(config);
    const drops: EventDrops = { actions: [], facets: [] };
    const isKnownMiniAppTarget = (value: string): boolean => this.miniApps.isKnownMiniAppTarget(value);
    const overlays = places.map((doc) => toEventOverlay(doc, { config, drops, isKnownMiniAppTarget }));
    this.warnDrops(config.layerSetId, drops);
    return { overlays };
  }

  // WHY: counted and logged, not thrown: one unusable row must not take the other places with it.
  private async renderablePlaces(config: EventMapConfig): Promise<MapPlaceDoc[]> {
    const places = await this.repository.listPlacesByLayerSetId(config.layerSetId);
    const renderable = places.filter(isRenderable);
    if (renderable.length !== places.length) {
      logger.warn(
        { event: "map.event_overlays.places_unrenderable", layerSetId: config.layerSetId, count: places.length - renderable.length },
        "Places not renderable, skipped",
      );
    }
    return renderable;
  }

  private warnDrops(layerSetId: string, { actions, facets }: EventDrops): void {
    if (actions.length > 0) {
      logger.warn(
        { event: "map.event_overlays.actions_dropped", layerSetId, count: actions.length, dropped: actions },
        "Sheet buttons dropped",
      );
    }
    if (facets.length > 0) {
      logger.warn(
        { event: "map.event_overlays.facets_dropped", layerSetId, count: facets.length, dropped: facets },
        "List facet values dropped",
      );
    }
  }
}
