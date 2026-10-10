import { Controller, Get, Query } from "@nestjs/common";
import { CacheControl } from "../../http/cache-control.decorator";
import { Lang } from "../../http/lang.decorator";
import { withMeta } from "../../http/response.interceptor";
import type { WithMeta } from "../../http/response.types";
import { ZodValidationPipe } from "../../http/zod-validation.pipe";
import type { SupportedLang } from "../../infra/types";
import { BUILDING_CACHE_CONTROL } from "../building.rules";
import { buildingSearchQuery, type BuildingSearchQuery } from "./building-search.schema";
import { BuildingSearchService } from "./building-search.service";
import type { BuildingSearch } from "./building-search.types";

// (A perimeter detail is left out of the public history.)
@Controller("building")
export class BuildingSearchController {
  constructor(private readonly buildingSearch: BuildingSearchService) {}

  @Get("search")
  @CacheControl(BUILDING_CACHE_CONTROL)
  async search(
    @Query(
      new ZodValidationPipe(buildingSearchQuery, "INVALID_PARAMS", {
        q: "MISSING_QUERY",
        campus: "INVALID_CAMPUS",
      }),
    )
    query: BuildingSearchQuery,
    @Lang() lang: SupportedLang,
  ): Promise<WithMeta<BuildingSearch["data"]>> {
    const { data, meta } = await this.buildingSearch.search(query.q, query.campus ?? null, lang);
    return withMeta(data, meta);
  }
}
