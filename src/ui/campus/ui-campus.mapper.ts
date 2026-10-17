import type { SupportedLang } from "../../infra/types";
import { toBannerCarousel } from "../ui.mapper";
import type { CampusBannerCarouselRaw } from "./ui-campus.schema";
import type { CampusSheet } from "./ui-campus.wire";

interface CampusSheetSource {
  banners: CampusBannerCarouselRaw;
  lang: SupportedLang;
  now: Date;
}

const CAMPUS_MIN_APP_VERSION = "2.0.0";

export function toCampusSheet({ banners, lang, now }: CampusSheetSource): CampusSheet {
  const carousel = toBannerCarousel(banners, lang, now);
  // WHY: unlike home, the campus sheet has no default banner to draw in an empty carousel, so it is dropped.
  const carousels = carousel.items.length > 0 ? [carousel] : [];
  return { minAppVersion: CAMPUS_MIN_APP_VERSION, sections: carousels };
}
