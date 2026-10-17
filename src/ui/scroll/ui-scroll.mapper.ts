import { t } from "../../infra/i18n";
import type { SupportedLang } from "../../infra/types";
import { LOST_AND_FOUND_COLOR, LOST_AND_FOUND_PATH } from "./ui-scroll.constants";
import type { ScrollCards } from "./ui-scroll.wire";

const CAMPUS_MAP_ALT_URL = "https://namu.wiki/w/%EB%8F%84%EB%A7%9D%EC%B3%90";

export function toScrollCards(lang: SupportedLang, webviewOrigin: string): ScrollCards {
  return [
    {
      title: t("scroll.hsscMap.title", lang),
      icon: "Icons.outbound",
      pageLink: "/webview",
      altPageLink: CAMPUS_MAP_ALT_URL,
      useAltPageLink: false,
    },
    {
      title: t("scroll.nscMap.title", lang),
      icon: "Icons.outbound",
      pageLink: "/webview",
      altPageLink: CAMPUS_MAP_ALT_URL,
      useAltPageLink: false,
    },
    {
      title: t("scroll.lostFound.title", lang),
      icon: "Icons.bus_alert",
      pageLink: "/webview",
      color: LOST_AND_FOUND_COLOR,
      pageWebviewLink: `${webviewOrigin}${LOST_AND_FOUND_PATH}`,
      altPageLink: "https://www.skku.edu/skku/campus/support/lost_and_found_2.do",
      useAltPageLink: false,
    },
  ];
}
