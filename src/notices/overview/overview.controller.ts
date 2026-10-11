import { Controller, Get, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { sendSuccess, withMeta } from "../../http/response.interceptor";
import { NoticesOverviewService } from "./overview.service";

/**
 * (A perimeter detail is left out of the public history.)
 *
 */
@Controller("notices")
export class NoticesOverviewController {
  constructor(private readonly overview: NoticesOverviewService) {}

  @Get("overview")
  async get(
    @Query("q") qQuery: unknown,
    @Query("sourceIds") sourceIdsQuery: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { overview, meta } = await this.overview.getOverview(
      qQuery,
      sourceIdsQuery,
      req.lang ?? "ko",
    );
    sendSuccess(req, res, withMeta({ overview }, meta));
  }
}
