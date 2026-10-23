import type { SubwayStationCoordsData } from "./subway-station-coords.types";

// CONTRACT(scripts): written by scripts/lib/datasets/store.js (npm run data), which validates at push;
// the server still parses it where it reads it.
export interface SubwayStationCoordsDatasetDoc {
  _id: string;
  revision: number;
  data: SubwayStationCoordsData;
  updatedAt: Date;
  updatedBy: string;
}

export type StoredStationCoords = Pick<SubwayStationCoordsDatasetDoc, "revision" | "data">;
