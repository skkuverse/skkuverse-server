import { Module } from "@nestjs/common";
import { BuildingModule } from "../building.module";
import { BuildingPlaceRepository } from "./building-place.repository";
import { BuildingPlaceService } from "./building-place.service";

@Module({
  imports: [BuildingModule],
  providers: [BuildingPlaceService, BuildingPlaceRepository],
  exports: [BuildingPlaceService],
})
export class BuildingPlaceModule {}
