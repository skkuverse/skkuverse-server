import { Controller, Get, Param } from "@nestjs/common";
import { CacheControl } from "../../http/cache-control.decorator";
import { Lang } from "../../http/lang.decorator";
import type { SupportedLang } from "../../infra/types";
import { toMiniAppNotFound } from "../miniapps.rules";
import { MiniappsService } from "../miniapps.service";
import type { MiniAppDetail } from "../miniapps.wire";
import { MiniappsNotificationsService } from "../notifications/miniapps-notifications.service";
import type { MiniAppFeed } from "../notifications/miniapps-notifications.wire";
import { FEED_CACHE_CONTROL, REGISTRY_CACHE_CONTROL } from "./miniapps-catalog.constants";
import { MiniappsCatalogService } from "./miniapps-catalog.service";
import type { MiniAppIndex } from "./miniapps-catalog.wire";

@Controller("miniapps")
export class MiniappsCatalogController {
  constructor(
    private readonly miniApps: MiniappsService,
    private readonly catalog: MiniappsCatalogService,
    private readonly notifications: MiniappsNotificationsService,
  ) {}

  @Get()
  @CacheControl(REGISTRY_CACHE_CONTROL)
  index(): MiniAppIndex {
    return this.catalog.index();
  }

  @Get(":id/notifications")
  @CacheControl(FEED_CACHE_CONTROL)
  async feed(@Param("id") id: string, @Lang() lang: SupportedLang): Promise<MiniAppFeed> {
    if (!this.miniApps.isRegistered(id)) throw toMiniAppNotFound(id);
    return this.notifications.feed(id, lang);
  }

  @Get(":id")
  @CacheControl(REGISTRY_CACHE_CONTROL)
  async detail(@Param("id") id: string): Promise<MiniAppDetail> {
    const detail = await this.catalog.detail(id);
    if (!detail) throw toMiniAppNotFound(id);
    return detail;
  }
}
