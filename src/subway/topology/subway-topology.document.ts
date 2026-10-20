import type { SubwayTopologyData } from "./subway-topology.types";

// CONTRACT(scripts): written by scripts/lib/datasets/store.js (npm run data), which validates at push;
// the server still parses it where it reads it.
export interface SubwayTopologyDatasetDoc {
  _id: string;
  revision: number;
  data: SubwayTopologyData;
  updatedAt: Date;
  updatedBy: string;
}

export type StoredSubwayTopology = Pick<SubwayTopologyDatasetDoc, "revision" | "data">;
