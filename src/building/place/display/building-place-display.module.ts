import { Module } from "@nestjs/common";
import { BuildingPlaceModule } from "../building-place.module";
import { BuildingPlaceDisplayService } from "./building-place-display.service";

@Module({
  imports: [BuildingPlaceModule],
  providers: [BuildingPlaceDisplayService],
  exports: [BuildingPlaceDisplayService],
})
export class BuildingPlaceDisplayModule {}
