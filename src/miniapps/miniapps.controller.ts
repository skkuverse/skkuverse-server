import { Controller, Get, Param, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { AppError } from "../common/app-error";
import { MiniAppsService } from "./miniapps.service";
import { MiniAppNotificationsService } from "./miniapps-notifications.service";
import { MiniAppsManifestService } from "./miniapps.manifest";
import { DEFAULT_SHELL, mergeShell, parseShellFields } from "./shell";
import type {
  MiniAppDetailResponse,
  MiniAppIndexEntry,
  MiniAppNotificationEntry,
} from "./types";
import type { SupportedLang } from "../infra/types";

/**
 * The registry is JSON shipped with the build, identical for every client and
 * every language, and it changes only on deploy — so it may be cached by the
 * client and by a shared cache in front of the origin. Five minutes bounds how
 * long a deploy that edits it takes to be seen.
 */
const REGISTRY_CACHE_CONTROL = "public, max-age=300";

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
    private readonly manifest: MiniAppsManifestService,
  ) {}

  // GET /miniapps
  @Get()
  getIndex(@Res({ passthrough: true }) res: Response): MiniAppIndexResponse {
    res.set("Cache-Control", REGISTRY_CACHE_CONTROL);
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

  /**
   * GET /miniapps/:id — the registry detail, with `shell` always the complete
   * merged config: `DEFAULT_SHELL`, overridden by the registry's own
   * (optional) fields, overridden again by the mini app's own manifest (for a
   * first-party mini app that has shipped one; `{}` otherwise). See
   * `miniapps.manifest.ts` for the fetch/cache and `shell.ts` for the merge.
   */
  @Get(":id")
  async getDetail(
    @Param("id") id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Readonly<MiniAppDetailResponse>> {
    const detail = this.miniApps.getDetail(id);
    if (!detail) {
      throw new AppError("MINIAPP_NOT_FOUND", `Unknown mini-app id: ${id}`, 404);
    }
    const manifestFields = await this.manifest.getShellFields(detail);
    const shell = mergeShell(
      mergeShell(DEFAULT_SHELL, parseShellFields(detail.shell)),
      manifestFields,
    );
    // Set only on success, so a 404 for a slug that ships later is not kept.
    res.set("Cache-Control", REGISTRY_CACHE_CONTROL);
    return { ...detail, shell };
  }
}
