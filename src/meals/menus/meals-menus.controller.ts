import { Controller, Get, Query } from "@nestjs/common";
import { CacheControl } from "../../http/cache-control.decorator";
import { ZodValidationPipe } from "../../http/zod-validation.pipe";
import { DAILY_MEALS_CACHE_CONTROL } from "./meals-menus.constants";
import { dailyMealsQuery, type DailyMealsQuery } from "./meals-menus.schema";
import { MealsMenusService } from "./meals-menus.service";
import type { DailyMeals } from "./meals-menus.wire";

@Controller("meals")
export class MealsMenusController {
  constructor(private readonly menus: MealsMenusService) {}

  @Get()
  @CacheControl(DAILY_MEALS_CACHE_CONTROL)
  dailyMeals(
    @Query(new ZodValidationPipe(dailyMealsQuery, "INVALID_CAMPUS", { fieldCodes: { date: "INVALID_DATE" } }))
    query: DailyMealsQuery,
  ): Promise<DailyMeals> {
    return this.menus.listDailyMeals(query.campus, query.date);
  }
}
