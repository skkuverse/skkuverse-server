import type { CampusBannerCarouselRaw } from "./ui-campus.schema";

export interface CampusBannerIssue {
  path: Array<string | number>;
  message: string;
}

export interface CampusBannersRevision {
  revision: number;
  banners: CampusBannerCarouselRaw;
}
