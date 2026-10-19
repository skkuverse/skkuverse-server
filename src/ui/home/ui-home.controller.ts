import { Controller, Get } from "@nestjs/common";
import { CacheControl } from "../../http/cache-control.decorator";
import { Lang } from "../../http/lang.decorator";
import type { SupportedLang } from "../../infra/types";
import { UI_CACHE_CONTROL } from "../ui.constants";
import { UiHomeService } from "./ui-home.service";
import type { HomeLayout } from "./ui-home.wire";

@Controller("ui")
export class UiHomeController {
  constructor(private readonly home: UiHomeService) {}

  @Get("home")
  @CacheControl(UI_CACHE_CONTROL)
  async getHome(@Lang() lang: SupportedLang): Promise<HomeLayout> {
    return this.home.getHomeLayout(lang);
  }
}
