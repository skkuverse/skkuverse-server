import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { MealsCatalogModule } from "../catalog/meals-catalog.module";
import { MealsModule } from "../meals.module";
import { MealsMenusController } from "./meals-menus.controller";
import { MealsMenusRepository } from "./meals-menus.repository";
import { MealsMenusService } from "./meals-menus.service";

@Module({
  imports: [MealsModule, MealsCatalogModule],
  controllers: [MealsMenusController],
  providers: [MealsMenusService, MealsMenusRepository, Clock],
})
export class MealsMenusModule {}
