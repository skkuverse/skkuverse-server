import { Controller, Get, Param, Query } from "@nestjs/common";
import { AppError } from "../../http/app.error";
import { CacheControl } from "../../http/cache-control.decorator";
import { Lang } from "../../http/lang.decorator";
import { ZodValidationPipe } from "../../http/zod-validation.pipe";
import type { SupportedLang } from "../../infra/types";
import { BUILDING_CACHE_CONTROL } from "../building.rules";
import type { SkkuId } from "../building.types";
import { buildingListQuery, skkuIdParam, type BuildingListQuery } from "./building-catalog.schema";
import { BuildingCatalogService } from "./building-catalog.service";
import type { BuildingDetail, BuildingList } from "./building-catalog.types";

@Controller("building")
export class BuildingCatalogController {
  constructor(private readonly catalog: BuildingCatalogService) {}

  @Get("list")
  @CacheControl(BUILDING_CACHE_CONTROL)
  list(
    @Query(new ZodValidationPipe(buildingListQuery, "INVALID_CAMPUS"))
    query: BuildingListQuery,
    @Lang() lang: SupportedLang,
  ): Promise<BuildingList> {
    return this.catalog.list(query.campus, lang);
  }

  @Get(":skkuId")
  @CacheControl(BUILDING_CACHE_CONTROL)
  async detail(
    @Param("skkuId", new ZodValidationPipe(skkuIdParam, "INVALID_ID")) skkuId: SkkuId,
    @Lang() lang: SupportedLang,
  ): Promise<BuildingDetail> {
    const detail = await this.catalog.detail(skkuId, lang);
    if (!detail) {
      throw new AppError("NOT_FOUND", `Building ${skkuId} not found`, 404);
    }
    return detail;
  }
}
