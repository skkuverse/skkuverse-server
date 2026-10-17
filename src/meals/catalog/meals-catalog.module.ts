import { Module } from "@nestjs/common";
import { BuildingModule } from "../../building/building.module";
import { BuildingCafeteriaListModule } from "../../building/cafeteria-list/building-cafeteria-list.module";
import { MealsModule } from "../meals.module";
import { MealsCatalogController } from "./meals-catalog.controller";
import { MealsCatalogService } from "./meals-catalog.service";

@Module({
  imports: [MealsModule, BuildingModule, BuildingCafeteriaListModule],
  controllers: [MealsCatalogController],
  providers: [MealsCatalogService],
  exports: [MealsCatalogService],
})
export class MealsCatalogModule {}
