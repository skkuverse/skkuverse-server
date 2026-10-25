import { Injectable } from "@nestjs/common";
import config from "../../infra/config";
import { createLogThrottle } from "../../shared/log-throttle.util";
import logger from "../../infra/logger";
import type { SupportedLang } from "../../infra/types";
import type { LayerSet } from "../layer-set/map-layer-set.schema";
import { MapLayerSetService } from "../layer-set/map-layer-set.service";
import { LOOKUP_FAILED_LOG_INTERVAL_MS } from "./map-config.constants";
import { toMapConfig } from "./map-config.mapper";
import type { MapConfig } from "./map-config.wire";

@Injectable()
export class MapConfigService {
  private readonly lookupFailedThrottle = createLogThrottle(LOOKUP_FAILED_LOG_INTERVAL_MS);

  constructor(private readonly layerSet: MapLayerSetService) {}

  // WHY: one live layer set read per request, shared by the layers and the chips, so the two cannot disagree.
  async getMapConfig(lang: SupportedLang): Promise<MapConfig> {
    const liveLayerSet = await this.liveLayerSet();
    return toMapConfig({
      lang,
      styleId: config.naver.styleId,
      layers: this.layerSet.servedLayerSpecs(liveLayerSet),
      chips: this.layerSet.servedChipSpecs(liveLayerSet),
    });
  }

  // WHY: a failed lookup serves the base layers: the app's fallback for a failed /map/config has no building layers.
  private async liveLayerSet(): Promise<LayerSet | null> {
    try {
      return await this.layerSet.liveLayerSet();
    } catch (err) {
      const ticket = this.lookupFailedThrottle.take("event-layers");
      if (ticket) {
        logger.warn(
          { event: "map.event_layers.lookup_failed", err, suppressed: ticket.suppressed },
          "Event layer lookup failed, serving base layers only",
        );
      }
      return null;
    }
  }
}
