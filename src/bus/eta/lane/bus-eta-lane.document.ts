import type { LaneCorridorData } from "./bus-eta-lane.types";

// CONTRACT(scripts): written by scripts/lib/datasets/store.js (npm run data), which validates at push;
// the server still parses it where it reads it.
export interface BusLaneCorridorDatasetDoc {
  _id: string;
  revision: number;
  data: LaneCorridorData;
  updatedAt: Date;
  updatedBy: string;
}

export type StoredLaneCorridor = Pick<BusLaneCorridorDatasetDoc, "revision" | "data">;
