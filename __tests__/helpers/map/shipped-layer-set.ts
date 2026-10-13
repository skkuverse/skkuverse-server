/**
 * The committed layer set, as test data for the specs of the flows that read
 * it (event, event-details, config): loaded by its real loader, so a spec in a
 * sibling flow does not import layer-set/ internals to get it.
 */
import { getLayerSetConfig } from "../../../src/map/layer-set/map-layer-set.config";
import type { EventMapConfig } from "../../../src/map/layer-set/map-layer-set.schema";

export function shippedLayerSet(layerSetId = "eskara-2026"): EventMapConfig {
  const loaded = getLayerSetConfig(layerSetId);
  if (!loaded?.config) throw new Error(`${layerSetId} failed to load: ${loaded?.error}`);
  return loaded.config;
}
