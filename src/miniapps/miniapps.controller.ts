import { Controller, Get, Param } from "@nestjs/common";
import { AppError } from "../common/app-error";
import { MiniAppsService } from "./miniapps.service";
import type { MiniAppDetail, MiniAppIndexEntry } from "./types";

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
  constructor(private readonly miniApps: MiniAppsService) {}

  // GET /miniapps
  @Get()
  getIndex(): MiniAppIndexResponse {
    return { version: this.miniApps.version, miniApps: this.miniApps.list };
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
