import { Controller, Get, Param, Res } from "@nestjs/common";
import type { Response } from "express";
import { AppError } from "../../http/app.error";
import { CacheControl } from "../../http/cache-control.decorator";
import { Lang } from "../../http/lang.decorator";
import type { SupportedLang } from "../../infra/types";
import type { MiniAppDetail } from "../miniapps.wire";
import { MiniappsNotificationsService } from "../notifications/miniapps-notifications.service";
import type { MiniAppFeed } from "../notifications/miniapps-notifications.wire";
import { FEED_CACHE_CONTROL, REGISTRY_CACHE_CONTROL } from "./miniapps-catalog.constants";
import { MiniappsCatalogService } from "./miniapps-catalog.service";
import type { MiniAppIndex } from "./miniapps-catalog.wire";

@Controller("miniapps")
export class MiniappsCatalogController {
  constructor(
    private readonly catalog: MiniappsCatalogService,
    private readonly notifications: MiniappsNotificationsService,
  ) {}

  @Get()
  @CacheControl(REGISTRY_CACHE_CONTROL)
  index(): MiniAppIndex {
    return this.catalog.index();
  }

  // WHY: set before the read, so a failed read's 500 carries it too; moving it to success only changes what is
  // served, tracked in spencer0124/skkuverse#79.
  @Get(":id/notifications")
  async feed(@Param("id") id: string, @Lang() lang: SupportedLang, @Res({ passthrough: true }) res: Response): Promise<MiniAppFeed> {
    if (!this.catalog.isRegistered(id)) throw this.notFound(id);
    res.set("Cache-Control", FEED_CACHE_CONTROL);
    return this.notifications.feed(id, lang);
  }

  @Get(":id")
  @CacheControl(REGISTRY_CACHE_CONTROL)
  async detail(@Param("id") id: string): Promise<MiniAppDetail> {
    const detail = await this.catalog.detail(id);
    if (!detail) throw this.notFound(id);
    return detail;
  }

  private notFound(id: string): AppError {
    return new AppError("MINIAPP_NOT_FOUND", `Unknown mini-app id: ${id}`, 404);
  }
}
