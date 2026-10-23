import type { AppFeatures } from "./app-config.types";

// CONTRACT(scripts): written by scripts/lib/datasets/store.js (npm run data), which validates at push;
// the server still parses it where it reads it.
export interface AppFeaturesDatasetDoc {
  _id: string;
  revision: number;
  data: AppFeatures;
  updatedAt: Date;
  updatedBy: string;
}

export type StoredAppFeatures = Pick<AppFeaturesDatasetDoc, "revision" | "data">;
