import { Controller, Get, Param, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { AppError } from "../http/app.error";
import { withMeta } from "../http/response.interceptor";
import { ZodValidationPipe } from "../http/zod-validation.pipe";
import type { SupportedLang } from "../infra/types";
import {
  buildingListQuery,
  buildingSearchQuery,
  skkuIdParam,
  type BuildingListQuery,
  type BuildingSearchQuery,
} from "./building.schema";
import { BuildingService } from "./building.service";
import type { SkkuId } from "./building.types";

/** /building: no auth, the general limiter (BuildingModule). */
@Controller("building")
export class BuildingController {
  constructor(private readonly building: BuildingService) {}

  // GET /building/list?campus=hssc
  @Get("list")
  list(
    @Query(new ZodValidationPipe(buildingListQuery, "INVALID_CAMPUS"))
    query: BuildingListQuery,
    @Req() req: Request,
  ) {
    return this.building.list(query.campus ?? null, req.lang as SupportedLang);
  }

  // GET /building/search?q=도서&campus=nsc
  @Get("search")
  async search(
    @Query(
      new ZodValidationPipe(buildingSearchQuery, "INVALID_PARAMS", {
        q: "MISSING_QUERY",
        campus: "INVALID_CAMPUS",
      }),
    )
    query: BuildingSearchQuery,
    @Req() req: Request,
  ) {
    const { data, meta } = await this.building.search(
      query.q,
      query.campus ?? null,
      req.lang as SupportedLang,
    );
    return withMeta(data, meta);
  }

  // GET /building/:skkuId
  @Get(":skkuId")
  async detail(
    @Param("skkuId", new ZodValidationPipe(skkuIdParam, "INVALID_ID")) skkuId: SkkuId,
    @Req() req: Request,
  ) {
    const detail = await this.building.detail(skkuId, req.lang as SupportedLang);
    if (!detail) {
      throw new AppError("NOT_FOUND", `Building ${skkuId} not found`, 404);
    }
    return detail;
  }
}
