import { Injectable } from "@nestjs/common";
import { createCachedLoader } from "../../infra/cached-loader";
import { createLogThrottle } from "../../shared/log-throttle.util";
import logger from "../../infra/logger";
import { MiniappsService } from "../../miniapps/miniapps.service";
import { MapLayerSetService } from "../layer-set/map-layer-set.service";
import { EVENT_CACHE_TTL_MS, EVENT_STALE_WINDOW_MS } from "../map.constants";
import { MapRepository } from "../map.repository";
import type { MapOverlays } from "../map.wire";
import { REGISTRY_UNAVAILABLE_LOG_INTERVAL_MS } from "./map-event.constants";
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

  private readonly registryThrottle = createLogThrottle(REGISTRY_UNAVAILABLE_LOG_INTERVAL_MS);

  constructor(
    private readonly repository: MapRepository,
    private readonly layerSet: MapLayerSetService,
    private readonly miniApps: MiniappsService,
  ) {}

  /** WHY: empty, not an error, when no festival is live: the app asks whenever the layer is configured. */
  getEventOverlays(): Promise<MapOverlays> {
    return this.overlaysCache.get();
  }

  private async loadEventOverlays(): Promise<MapOverlays> {
    const liveLayerSet = await this.layerSet.liveLayerSet();
    if (!liveLayerSet) return { overlays: [] };
    const places = await this.repository.listPlacesByLayerSetId(liveLayerSet.layerSetId);
    if (places.length === 0) return { overlays: [] };
    const drops: EventDrops = { actions: [], facets: [] };
    const isKnownMiniAppTarget = await this.miniAppTargetCheck(liveLayerSet.layerSetId);
    const overlays = places.map((doc) => toEventOverlay(doc, { layerSet: liveLayerSet, drops, isKnownMiniAppTarget }));
    this.warnDrops(liveLayerSet.layerSetId, drops);
    return { overlays };
  }

  // WHY: the map fails soft (ADR 0010 D5): with no registry read, a `miniapp` button is unresolved and dropped, never the place.
  private async miniAppTargetCheck(layerSetId: string): Promise<(value: string) => boolean> {
    const registry = await this.miniApps.findCurrent();
    if (registry !== null) return (value) => registry.isKnownMiniAppTarget(value);
    const taken = this.registryThrottle.take("registry_unavailable");
    if (taken) {
      logger.error({ event: "map.event_overlays.registry_unavailable", layerSetId, ...taken }, "Mini app registry unavailable with a festival live — miniapp buttons dropped");
    }
    return () => false;
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
