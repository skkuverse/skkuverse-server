import type { EventMapConfig } from "../layer-set/map-layer-set.schema";

export interface EventDrops {
  actions: string[];
  facets: string[];
}

export interface EventOverlayContext {
  config: EventMapConfig;
  drops: EventDrops;
  isKnownMiniAppTarget: (value: string) => boolean;
}
