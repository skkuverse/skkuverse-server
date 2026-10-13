import { Injectable } from "@nestjs/common";
import { createCachedLoader } from "../../infra/cached-loader";
import { Clock } from "../../infra/clock";
import logger from "../../infra/logger";
import { BASE_LAYERS, EVENT_CACHE_TTL_MS, EVENT_STALE_WINDOW_MS } from "../map.constants";
import { MapRepository } from "../map.repository";
import type { LayerSpec } from "../map.types";
import { getLayerSetConfig } from "./map-layer-set.config";
import { BASE_CHIPS } from "./map-layer-set.constants";
import { eventChipSpecs, eventLayerSpecs } from "./map-layer-set.mapper";
import type { EventMapConfig } from "./map-layer-set.schema";
import type { LoadedConfig, MapChipSpec } from "./map-layer-set.types";

// SEE: docs/explanation/map-architecture.md (Structure): /map/config and the event routes ask this one service.
@Injectable()
export class MapLayerSetService {
  private readonly reported = new Set<string>();

  private readonly activationCache = createCachedLoader({
    name: "event activation",
    ttlMs: EVENT_CACHE_TTL_MS,
    staleWindowMs: EVENT_STALE_WINDOW_MS,
    load: () => this.repository.findActiveActivation(this.clock.now()),
  });

  constructor(
    private readonly repository: MapRepository,
    private readonly clock: Clock,
  ) {}

  /** WHY: a cached activation is checked against the clock on every call, so its window closes on time between reloads. */
  async activeEvent(): Promise<EventMapConfig | null> {
    const activation = await this.activationCache.get();
    if (!activation) return null;
    if (activation.activeUntil && activation.activeUntil <= this.clock.now()) return null;
    const loaded = getLayerSetConfig(activation._id);
    if (loaded?.config) return loaded.config;
    this.reportUnservable(activation._id, loaded);
    return null;
  }

  servedLayerSpecs(event: EventMapConfig | null): readonly LayerSpec[] {
    return event ? [...BASE_LAYERS, ...eventLayerSpecs(event)] : BASE_LAYERS;
  }

  servedChipSpecs(event: EventMapConfig | null): readonly MapChipSpec[] {
    return event ? [...BASE_CHIPS, ...eventChipSpecs(event)] : BASE_CHIPS;
  }

  // WHY: once per layer set per process: a warn per request would bury the one line that matters.
  private reportUnservable(activationId: string, loaded: LoadedConfig | null): void {
    if (this.reported.has(activationId)) return;
    this.reported.add(activationId);
    logger.warn(
      {
        event: "map.eventmap.activation_unservable",
        activationId,
        reason: loaded === null ? "no_config_in_build" : "config_rejected",
        configError: loaded?.error,
      },
      "Event map activation is live but unservable — serving no event layers",
    );
  }
}
