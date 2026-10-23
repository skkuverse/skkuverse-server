import type { HsscRouteLineData } from "./bus-hssc-route-line.types";

// CONTRACT(scripts): written by scripts/lib/datasets/store.js (npm run data), which validates at push;
// the server still parses it where it reads it.
export interface HsscRouteLineDatasetDoc {
  _id: string;
  revision: number;
  data: HsscRouteLineData;
  updatedAt: Date;
  updatedBy: string;
}

export type StoredHsscRouteLine = Pick<HsscRouteLineDatasetDoc, "revision" | "data">;
