import type { CampusBannerCarouselRaw } from "./ui-campus.schema";

export interface CampusBannerIssue {
  path: Array<string | number>;
  message: string;
}

export interface CampusBannersRevision {
  revision: number;
  banners: CampusBannerCarouselRaw;
}

/** WHY: keyed `<banners revision>@<registry revision>`, `-` for none read, so a push of either recomputes it. */
export interface ResolvedCampusBanners {
  key: string;
  banners: CampusBannerCarouselRaw;
}
