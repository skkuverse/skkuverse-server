import { Controller, Get } from "@nestjs/common";
import { Lang } from "../../http/lang.decorator";
import { withMeta } from "../../http/response.interceptor";
import type { WithMeta } from "../../http/response.types";
import type { SupportedLang } from "../../infra/types";
import { UiTransitListService } from "./ui-transit-list.service";
import type { TransitList, TransitListMeta } from "./ui-transit-list.wire";

@Controller("ui")
export class UiTransitListController {
  constructor(private readonly transitList: UiTransitListService) {}

  @Get("home/transitlist")
  getTransitList(@Lang() lang: SupportedLang): WithMeta<TransitList, TransitListMeta> {
    const cards = this.transitList.listBusGroupCards(lang);
    return withMeta(cards, { busListCount: cards.length });
  }
}
