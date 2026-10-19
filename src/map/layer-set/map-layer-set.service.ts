import { Injectable } from "@nestjs/common";
import { createCachedLoader } from "../../infra/cached-loader";
import { Clock } from "../../infra/clock";
import { createDatasetLoader, type DatasetLoader } from "../../infra/dataset-loader";
import { createLogThrottle } from "../../infra/log-throttle";
import logger from "../../infra/logger";
import { BASE_LAYERS, EVENT_CACHE_TTL_MS, EVENT_STALE_WINDOW_MS } from "../map.constants";
import { MapRepository } from "../map.repository";
import type { LayerSpec } from "../map.types";
import { BASE_CHIPS, MAP_LAYER_SETS_LOG_INTERVAL_MS } from "./map-layer-set.constants";
import { MapLayerSetsReadError, MapLayerSetsUnavailableError } from "./map-layer-set.error";
import { eventChipSpecs, eventLayerSpecs } from "./map-layer-set.mapper";
import { MapLayerSetRepository } from "./map-layer-set.repository";
import { assertValidChipSpecs, assertValidLinkChips } from "./map-layer-set.rules";
import type { LayerSet } from "./map-layer-set.schema";
import type { MapChipSpec, MapLayerSetsRevision } from "./map-layer-set.types";

// SEE: docs/explanation/map-architecture.md (Structure): /map/config and the event routes ask this one service.
@Injectable()
export class MapLayerSetService {
  private readonly reported = new Set<string>();
  private readonly unavailableThrottle: ReturnType<typeof createLogThrottle>;
  private readonly layerSets: DatasetLoader<MapLayerSetsRevision>;

  private readonly activationCache = createCachedLoader({
    name: "event activation",
    ttlMs: EVENT_CACHE_TTL_MS,
    staleWindowMs: EVENT_STALE_WINDOW_MS,
    load: () => this.repository.findActiveActivation(this.clock.now()),
  });

  // WHY: the permanent chips are checked when Nest builds the provider, so a broken one fails the boot.
  constructor(
    private readonly repository: MapRepository,
    layerSetRepository: MapLayerSetRepository,
    private readonly clock: Clock,
  ) {
    assertValidChipSpecs(BASE_CHIPS, BASE_LAYERS);
    assertValidLinkChips(BASE_CHIPS);
    this.unavailableThrottle = createLogThrottle(MAP_LAYER_SETS_LOG_INTERVAL_MS, () => clock.now().getTime());
    this.layerSets = createDatasetLoader({
      name: "map.layer_sets",
      load: () => layerSetRepository.findLayerSets(),
      clock,
      isReadError: (err): err is MapLayerSetsReadError => err instanceof MapLayerSetsReadError,
      toUnavailable: () => new MapLayerSetsUnavailableError(),
      readFailedEvent: "map.layer_sets.read_failed",
      logIntervalMs: MAP_LAYER_SETS_LOG_INTERVAL_MS,
    });
  }

  /** WHY: a cached activation is checked against the clock on every call, so its window closes on time between reloads. */
  async liveLayerSet(): Promise<LayerSet | null> {
    const activation = await this.activationCache.get();
    if (!activation) return null;
    if (activation.activeUntil && activation.activeUntil <= this.clock.now()) return null;
    const stored = await this.storedLayerSets(activation._id);
    if (stored === null) return null;
    const layerSet = stored.layerSets.find((set) => set.layerSetId === activation._id);
    if (layerSet) return layerSet;
    this.reportUnservable(activation._id, stored);
    return null;
  }

  servedLayerSpecs(event: LayerSet | null): readonly LayerSpec[] {
    return event ? [...BASE_LAYERS, ...eventLayerSpecs(event)] : BASE_LAYERS;
  }

  servedChipSpecs(event: LayerSet | null): readonly MapChipSpec[] {
    return event ? [...BASE_CHIPS, ...eventChipSpecs(event)] : BASE_CHIPS;
  }

  // WHY: the documented degraded answer (ADR 0013 D6): with no good layer sets read, the base map serves, never a 503.
  private async storedLayerSets(activationId: string): Promise<MapLayerSetsRevision | null> {
    try {
      return await this.layerSets.get();
    } catch (err) {
      if (!(err instanceof MapLayerSetsUnavailableError)) throw err;
      const taken = this.unavailableThrottle.take("unavailable");
      if (taken) {
        logger.error({ event: "map.layer_sets.unavailable", activationId, ...taken }, "Map layer sets unavailable with a festival live — serving the base map");
      }
      return null;
    }
  }

  // WHY: once per activation per revision: a warn per request would bury the one line that matters.
  private reportUnservable(activationId: string, stored: MapLayerSetsRevision): void {
    const key = `${activationId}@${stored.revision}`;
    if (this.reported.has(key)) return;
    this.reported.add(key);
    const rejected = stored.rejected.find((set) => set.layerSetId === activationId);
    logger.warn(
      {
        event: "map.eventmap.activation_unservable",
        activationId,
        revision: stored.revision,
        reason: rejected ? "layer_set_rejected" : "no_layer_set",
        issues: rejected?.issues,
      },
      "Event map activation is live but unservable — serving no event layers",
    );
  }
}
