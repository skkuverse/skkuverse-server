import { Controller, Get } from "@nestjs/common";
import { CacheControl } from "../../http/cache-control.decorator";
import { Lang } from "../../http/lang.decorator";
import type { WithMeta } from "../../http/response.types";
import type { SupportedLang } from "../../infra/types";
import { JOURNEY_ROUTES_CACHE_CONTROL } from "./journey-routes.constants";
import { JourneyRoutesService } from "./journey-routes.service";
import type { JourneyRoutes, JourneyRoutesMeta } from "./journey-routes.wire";

@Controller("journey")
export class JourneyRoutesController {
  constructor(private readonly routes: JourneyRoutesService) {}

  @Get("routes")
  @CacheControl(JOURNEY_ROUTES_CACHE_CONTROL)
  listRoutes(@Lang() lang: SupportedLang): Promise<WithMeta<JourneyRoutes, JourneyRoutesMeta>> {
    return this.routes.listRoutes(lang);
  }
}
