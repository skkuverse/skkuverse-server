import { Controller, Get } from "@nestjs/common";
import { CacheControl } from "../../http/cache-control.decorator";
import { Lang } from "../../http/lang.decorator";
import type { SupportedLang } from "../../infra/types";
import { UI_CACHE_CONTROL } from "../ui.constants";
import { UiCampusService } from "./ui-campus.service";
import type { CampusSheet } from "./ui-campus.wire";

@Controller("ui")
export class UiCampusController {
  constructor(private readonly campus: UiCampusService) {}

  @Get("home/campus")
  @CacheControl(UI_CACHE_CONTROL)
  getCampus(@Lang() lang: SupportedLang): CampusSheet {
    return this.campus.getCampusSheet(lang);
  }
}
