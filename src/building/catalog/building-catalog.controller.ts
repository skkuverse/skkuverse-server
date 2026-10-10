import { Controller, Get, Param, Query } from "@nestjs/common";
import { AppError } from "../../http/app.error";
import { Lang } from "../../http/lang.decorator";
import { ZodValidationPipe } from "../../http/zod-validation.pipe";
import type { SupportedLang } from "../../infra/types";
import type { SkkuId } from "../building.types";
import { buildingListQuery, skkuIdParam, type BuildingListQuery } from "./building-catalog.schema";
import { BuildingCatalogService } from "./building-catalog.service";

// (A perimeter detail is left out of the public history.)
@Controller("building")
export class BuildingCatalogController {
  constructor(private readonly catalog: BuildingCatalogService) {}

  @Get("list")
  list(
    @Query(new ZodValidationPipe(buildingListQuery, "INVALID_CAMPUS"))
    query: BuildingListQuery,
    @Lang() lang: SupportedLang,
  ) {
    return this.catalog.list(query.campus ?? null, lang);
  }

  @Get(":skkuId")
  async detail(
    @Param("skkuId", new ZodValidationPipe(skkuIdParam, "INVALID_ID")) skkuId: SkkuId,
    @Lang() lang: SupportedLang,
  ) {
    const detail = await this.catalog.detail(skkuId, lang);
    if (!detail) {
      throw new AppError("NOT_FOUND", `Building ${skkuId} not found`, 404);
    }
    return detail;
  }
}
