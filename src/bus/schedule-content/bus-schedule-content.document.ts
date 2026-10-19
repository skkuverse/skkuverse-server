import type { BusServiceNotices } from "./bus-schedule-content.schema";
import type { RestDays } from "./bus-schedule-content.types";

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

// CONTRACT(scripts): written by scripts/lib/datasets/store.js (npm run data): each key a MM-DD or YYYY-MM-DD, its
// value the label shown on the day; the server still parses it where it reads it.
export interface SkkuRestDaysDatasetDoc {
  _id: string;
  revision: number;
  data: Record<string, string>;
  updatedAt: Date;
  updatedBy: string;
}

export type StoredRestDays = Pick<SkkuRestDaysDatasetDoc, "revision"> & { data: RestDays };
