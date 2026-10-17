import { Controller, Get } from "@nestjs/common";
import { CacheControl } from "../../http/cache-control.decorator";
import { Lang } from "../../http/lang.decorator";
import type { SupportedLang } from "../../infra/types";
import { UI_CACHE_CONTROL } from "../ui.constants";
import { UiTransitService } from "./ui-transit.service";
import type { TransitLayout } from "./ui-transit.wire";

@Controller("ui")
export class UiTransitController {
  constructor(private readonly transit: UiTransitService) {}

  @Get("home/transit")
  @CacheControl(UI_CACHE_CONTROL)
  getTransitLayout(@Lang() lang: SupportedLang): TransitLayout {
    return this.transit.getTransitLayout(lang);
  }
}
