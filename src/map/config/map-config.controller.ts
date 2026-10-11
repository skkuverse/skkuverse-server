import { Controller, Get } from "@nestjs/common";
import { Lang } from "../../http/lang.decorator";
import type { SupportedLang } from "../../infra/types";
import { MapConfigService } from "./map-config.service";
import type { MapConfig } from "./map-config.wire";

@Controller("map/config")
export class MapConfigController {
  constructor(private readonly config: MapConfigService) {}

  @Get()
  getConfig(@Lang() lang: SupportedLang): Promise<MapConfig> {
    return this.config.getMapConfig(lang);
  }
}
