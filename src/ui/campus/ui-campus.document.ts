import type { CampusBannerCarouselRaw } from "./ui-campus.schema";

// CONTRACT(scripts): written by scripts/lib/datasets/store.js (npm run data), which validates at push;
// the server still parses it where it reads it.
export interface CampusBannersDatasetDoc {
  _id: string;
  revision: number;
  data: CampusBannerCarouselRaw;
  updatedAt: Date;
  updatedBy: string;
}

export type StoredCampusBanners = Pick<CampusBannersDatasetDoc, "revision" | "data">;
