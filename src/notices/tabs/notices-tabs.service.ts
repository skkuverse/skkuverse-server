import { Injectable } from "@nestjs/common";
import type { SupportedLang } from "../../infra/types";
import { noticesConfig } from "../notices.config";
import { toTabsResponse } from "./notices-tabs.mapper";
import type { NoticeTabs } from "./notices-tabs.wire";

@Injectable()
export class NoticesTabsService {
  private readonly tabsByLang = { ko: toTabsResponse(noticesConfig, "ko"), en: toTabsResponse(noticesConfig, "en") };

  // WHY: categories.json carries no zh label, so zh reads the English tabs.
  listTabs(lang: SupportedLang): NoticeTabs {
    return lang === "ko" ? this.tabsByLang.ko : this.tabsByLang.en;
  }
}
