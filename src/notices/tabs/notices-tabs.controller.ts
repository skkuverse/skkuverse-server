import { Controller, Get } from "@nestjs/common";
import { CacheControl } from "../../http/cache-control.decorator";
import { Lang } from "../../http/lang.decorator";
import type { SupportedLang } from "../../infra/types";
import { TABS_CACHE_CONTROL } from "./notices-tabs.constants";
import { NoticesTabsService } from "./notices-tabs.service";
import type { NoticeTabs } from "./notices-tabs.wire";

@Controller("notices")
export class NoticesTabsController {
  constructor(private readonly tabs: NoticesTabsService) {}

  @Get("tabs")
  @CacheControl(TABS_CACHE_CONTROL)
  listTabs(@Lang() lang: SupportedLang): NoticeTabs {
    return this.tabs.listTabs(lang);
  }
}
