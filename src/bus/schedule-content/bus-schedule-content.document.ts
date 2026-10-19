import type { BusServiceNotices } from "./bus-schedule-content.schema";

// CONTRACT(scripts): written by scripts/lib/datasets/store.js (npm run data), which validates at push;
// the server still parses it where it reads it.
export interface BusServiceNoticesDatasetDoc {
  _id: string;
  revision: number;
  data: BusServiceNotices;
  updatedAt: Date;
  updatedBy: string;
}

export type StoredServiceNotices = Pick<BusServiceNoticesDatasetDoc, "revision" | "data">;
