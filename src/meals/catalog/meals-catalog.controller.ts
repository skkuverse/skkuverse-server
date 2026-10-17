import { Controller, Get, Query } from "@nestjs/common";
import { CacheControl } from "../../http/cache-control.decorator";
import { ZodValidationPipe } from "../../http/zod-validation.pipe";
import { CAFETERIA_LIST_CACHE_CONTROL } from "./meals-catalog.constants";
import { cafeteriaListQuery, type CafeteriaListQuery } from "./meals-catalog.schema";
import { MealsCatalogService } from "./meals-catalog.service";
import type { CafeteriaList } from "./meals-catalog.wire";

@Controller("meals")
export class MealsCatalogController {
  constructor(private readonly catalog: MealsCatalogService) {}

  @Get("cafeterias")
  @CacheControl(CAFETERIA_LIST_CACHE_CONTROL)
  cafeterias(
    @Query(new ZodValidationPipe(cafeteriaListQuery, "INVALID_CAMPUS"))
    query: CafeteriaListQuery,
  ): Promise<CafeteriaList> {
    return this.catalog.listCafeterias(query.campus);
  }
}
