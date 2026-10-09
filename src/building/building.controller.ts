import { Controller, Get, Param, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { AppError } from "../common/app.error";
import { withMeta } from "../common/response.interceptor";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { SupportedLang } from "../infra/types";
import { buildingListQuery, buildingSearchQuery, skkuIdParam } from "./building.schema";
import { BuildingService } from "./building.service";

/** /building: no auth, the general limiter (BuildingModule). */
@Controller("building")
export class BuildingController {
  constructor(private readonly building: BuildingService) {}

  // GET /building/list?campus=hssc
  @Get("list")
  list(
    @Query(new ZodValidationPipe(buildingListQuery, { campus: "INVALID_CAMPUS" }))
    query: { campus?: "hssc" | "nsc" },
    @Req() req: Request,
  ) {
    return this.building.list(query.campus ?? null, req.lang as SupportedLang);
  }

  // GET /building/search?q=도서&campus=nsc
  @Get("search")
  async search(
    @Query(
      new ZodValidationPipe(buildingSearchQuery, { q: "MISSING_QUERY", campus: "INVALID_CAMPUS" }),
    )
    query: { q: string; campus?: "hssc" | "nsc" },
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
    @Param("skkuId", new ZodValidationPipe(skkuIdParam, "INVALID_ID")) skkuId: number,
    @Req() req: Request,
  ) {
    const detail = await this.building.detail(skkuId, req.lang as SupportedLang);
    if (!detail) {
      throw new AppError("NOT_FOUND", `Building ${skkuId} not found`, 404);
    }
    return detail;
  }
}
