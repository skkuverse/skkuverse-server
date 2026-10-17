import { Module } from "@nestjs/common";
import { BuildingModule } from "../building.module";
import { BuildingCafeteriaListRepository } from "./building-cafeteria-list.repository";
import { BuildingCafeteriaListService } from "./building-cafeteria-list.service";

@Module({
  imports: [BuildingModule],
  providers: [BuildingCafeteriaListService, BuildingCafeteriaListRepository],
  exports: [BuildingCafeteriaListService],
})
export class BuildingCafeteriaListModule {}
