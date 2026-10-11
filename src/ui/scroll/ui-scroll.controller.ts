import { Controller, Get } from "@nestjs/common";
import { Lang } from "../../http/lang.decorator";
import { withMeta } from "../../http/response.interceptor";
import type { WithMeta } from "../../http/response.types";
import type { SupportedLang } from "../../infra/types";
import { UiScrollService } from "./ui-scroll.service";
import type { ScrollCards, ScrollCardsMeta } from "./ui-scroll.wire";

@Controller("ui")
export class UiScrollController {
  constructor(private readonly scroll: UiScrollService) {}

  @Get("home/scroll")
  getScroll(@Lang() lang: SupportedLang): WithMeta<ScrollCards, ScrollCardsMeta> {
    const cards = this.scroll.listScrollCards(lang);
    return withMeta(cards, { itemCount: cards.length });
  }
}
