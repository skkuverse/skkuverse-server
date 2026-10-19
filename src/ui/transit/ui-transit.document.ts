import type { TransitLayoutRaw } from "./ui-transit.schema";

// CONTRACT(scripts): written by scripts/lib/datasets/store.js (npm run data), which validates at push;
// the server still parses it where it reads it.
export interface TransitLayoutDatasetDoc {
  _id: string;
  revision: number;
  data: TransitLayoutRaw;
  updatedAt: Date;
  updatedBy: string;
}

export type StoredTransitLayout = Pick<TransitLayoutDatasetDoc, "revision" | "data">;
