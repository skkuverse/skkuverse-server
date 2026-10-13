import type { LayerSet } from "../layer-set/map-layer-set.schema";

export interface EventDrops {
  actions: string[];
  facets: string[];
}

export interface EventOverlayContext {
  layerSet: LayerSet;
  drops: EventDrops;
  isKnownMiniAppTarget: (value: string) => boolean;
}
