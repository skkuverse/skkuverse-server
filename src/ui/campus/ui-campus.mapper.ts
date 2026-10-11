import { t } from "../../infra/i18n";
import type { SupportedLang } from "../../infra/types";
import { toBannerCarousel } from "../ui.mapper";
import type { CampusBannerCarouselRaw } from "./ui-campus.schema";
import type { CampusSheet } from "./ui-campus.wire";

type CampusButton = Extract<CampusSheet["sections"][number], { type: "button_grid" }>["items"][number];

interface CampusSheetSource {
  banners: CampusBannerCarouselRaw;
  lang: SupportedLang;
  now: Date;
  webviewOrigin: string;
}

const CAMPUS_MIN_APP_VERSION = "2.0.0";
const CAMPUS_BUTTON_COLUMNS = 4;

function toCampusButtons(lang: SupportedLang, webviewOrigin: string): CampusButton[] {
  const lostFoundTitle = t("campus.lostFound.title", lang);
  return [
    { id: "building_map", title: t("campus.buildingMap.title", lang), emoji: "🏢", actionType: "route", actionValue: "/map/hssc" },
    { id: "building_code", title: t("campus.buildingCode.title", lang), emoji: "🔢", actionType: "route", actionValue: "/search" },
    {
      id: "lost_found",
      title: lostFoundTitle,
      emoji: "🧳",
      actionType: "webview",
      actionValue: `${webviewOrigin}/skku/lostandfound`,
      webviewTitle: lostFoundTitle,
      webviewColor: "003626",
    },
    // WHY: https, as the home grid's copy of this button must be (ui.schema.ts); http only redirects here.
    { id: "inquiry", title: t("campus.inquiry.title", lang), emoji: "💬", actionType: "external", actionValue: "https://pf.kakao.com/_cjxexdG/chat" },
  ];
}

export function toCampusSheet({ banners, lang, now, webviewOrigin }: CampusSheetSource): CampusSheet {
  const carousel = toBannerCarousel(banners, lang, now);
  // WHY: unlike home, the campus sheet has no default banner to draw in an empty carousel, so it is dropped.
  const carousels = carousel.items.length > 0 ? [carousel] : [];
  const buttons = toCampusButtons(lang, webviewOrigin);
  return {
    minAppVersion: CAMPUS_MIN_APP_VERSION,
    sections: [...carousels, { type: "button_grid", id: "campus_buttons", columns: CAMPUS_BUTTON_COLUMNS, items: buttons }],
  };
}
