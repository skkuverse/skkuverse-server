import { Injectable } from "@nestjs/common";
import config from "../../infra/config";
import { createLogThrottle } from "../../infra/log-throttle";
import logger from "../../infra/logger";
import type { SupportedLang } from "../../infra/types";
import type { EventMapConfig } from "../layer-set/map-layer-set.schema";
import { MapLayerSetService } from "../layer-set/map-layer-set.service";
import { LOOKUP_FAILED_LOG_INTERVAL_MS } from "./map-config.constants";
import { toMapConfig } from "./map-config.mapper";
import type { MapConfig } from "./map-config.wire";

@Injectable()
export class MapConfigService {
  private readonly lookupFailedThrottle = createLogThrottle(LOOKUP_FAILED_LOG_INTERVAL_MS);

  constructor(private readonly layerSet: MapLayerSetService) {}

  // WHY: one live-event read per request, shared by the layers and the chips, so the two cannot disagree.
  async getMapConfig(lang: SupportedLang): Promise<MapConfig> {
    const event = await this.activeEvent();
    return toMapConfig({
      lang,
      styleId: config.naver.styleId,
      layers: this.layerSet.servedLayerSpecs(event),
      chips: this.layerSet.servedChipSpecs(event),
    });
  }

  // WHY: a failed lookup serves the base layers: the app's fallback for a failed /map/config has no building layers.
  private async activeEvent(): Promise<EventMapConfig | null> {
    try {
      return await this.layerSet.activeEvent();
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
