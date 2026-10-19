import type { CheckedLayerSets } from "./map-layer-set.types";

// CONTRACT(scripts): written by scripts/lib/datasets/store.js (npm run data), which validates at push;
// the server still parses each set where it reads it, so `layerSets` is unknown until then.
export interface MapLayerSetsDatasetDoc {
  _id: string;
  revision: number;
  data: { layerSets: unknown[] };
  updatedAt: Date;
  updatedBy: string;
}

export type StoredLayerSets = Pick<MapLayerSetsDatasetDoc, "revision"> & { data: CheckedLayerSets };
