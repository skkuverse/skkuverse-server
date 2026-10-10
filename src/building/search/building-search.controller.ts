import { Controller, Get, Query } from "@nestjs/common";
import { Lang } from "../../http/lang.decorator";
import { withMeta } from "../../http/response.interceptor";
import { ZodValidationPipe } from "../../http/zod-validation.pipe";
import type { SupportedLang } from "../../infra/types";
import { buildingSearchQuery, type BuildingSearchQuery } from "./building-search.schema";
import { BuildingSearchService } from "./building-search.service";

// (A perimeter detail is left out of the public history.)
@Controller("building")
export class BuildingSearchController {
  constructor(private readonly buildingSearch: BuildingSearchService) {}

  @Get("search")
  async search(
    @Query(
      new ZodValidationPipe(buildingSearchQuery, "INVALID_PARAMS", {
        q: "MISSING_QUERY",
        campus: "INVALID_CAMPUS",
      }),
    )
    query: BuildingSearchQuery,
    @Lang() lang: SupportedLang,
  ) {
    const { data, meta } = await this.buildingSearch.search(query.q, query.campus ?? null, lang);
    return withMeta(data, meta);
  }
}
