import type { HomeLayoutRaw } from "./ui-home.schema";

// CONTRACT(scripts): written by scripts/lib/datasets/store.js (npm run data), which validates at push;
// the server still parses it where it reads it.
export interface HomeLayoutDatasetDoc {
  _id: string;
  revision: number;
  data: HomeLayoutRaw;
  updatedAt: Date;
  updatedBy: string;
}

export type StoredHomeLayout = Pick<HomeLayoutDatasetDoc, "revision" | "data">;
