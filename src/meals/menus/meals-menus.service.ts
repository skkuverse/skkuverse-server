import { Injectable } from "@nestjs/common";
import type { Campus } from "../../building/building.types";
import { Clock } from "../../infra/clock";
import { toKstDate } from "../../shared/kst-date.util";
import { MealsCatalogService } from "../catalog/meals-catalog.service";
import { toDailyMeals } from "./meals-menus.mapper";
import { MealsMenusRepository } from "./meals-menus.repository";
import type { DailyMeals } from "./meals-menus.wire";

@Injectable()
export class MealsMenusService {
  constructor(
    private readonly catalog: MealsCatalogService,
    private readonly repository: MealsMenusRepository,
    private readonly clock: Clock,
  ) {}

  async listDailyMeals(campus: Campus, date: string | undefined): Promise<DailyMeals> {
    const servedDate = date ?? toKstDate(this.clock.now());
    const cafeterias = await this.catalog.listCafeterias(campus);
    const menus = await this.repository.listMenus(cafeterias.cafeterias.map((c) => c.id), servedDate);
    return toDailyMeals({ campus, date: servedDate }, cafeterias, menus);
  }
}
