import { Controller, Get, Param, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { AppError } from "../common/app-error";
import { MiniAppsService } from "./miniapps.service";
import { MiniAppNotificationsService } from "./miniapps-notifications.service";
import type {
  MiniAppDetail,
  MiniAppIndexEntry,
  MiniAppNotificationEntry,
} from "./types";
import type { SupportedLang } from "../infra/types";

interface MiniAppIndexResponse {
  version: number;
  miniApps: ReadonlyArray<Readonly<MiniAppIndexEntry>>;
}

/**
 * (A perimeter detail is left out of the public history.)
 *
 *
 *
 */
@Controller("miniapps")
export class MiniAppsController {
  constructor(
    private readonly miniApps: MiniAppsService,
    private readonly notifications: MiniAppNotificationsService,
  ) {}

  // GET /miniapps
  @Get()
  getIndex(): MiniAppIndexResponse {
    return { version: this.miniApps.version, miniApps: this.miniApps.list };
  }

  /**
   * (A perimeter detail is left out of the public history.)
   *
   *
   *
   */
  @Get(":id/notifications")
  async getNotifications(
    @Param("id") id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MiniAppNotificationEntry[]> {
    if (!this.miniApps.getDetail(id)) {
      throw new AppError("MINIAPP_NOT_FOUND", `Unknown mini-app id: ${id}`, 404);
    }
    res.set("Cache-Control", "public, max-age=15");
    return this.notifications.feed(id, (req.lang ?? "ko") as SupportedLang);
  }

  // GET /miniapps/:id
  @Get(":id")
  getDetail(@Param("id") id: string): Readonly<MiniAppDetail> {
    const detail = this.miniApps.getDetail(id);
    if (!detail) {
      throw new AppError("MINIAPP_NOT_FOUND", `Unknown mini-app id: ${id}`, 404);
    }
    return detail;
  }
}
