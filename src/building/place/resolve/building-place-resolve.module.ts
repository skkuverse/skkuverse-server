import { Module } from "@nestjs/common";
import { BuildingPlaceModule } from "../building-place.module";
import { BuildingPlaceResolveService } from "./building-place-resolve.service";

@Module({
  imports: [BuildingPlaceModule],
  providers: [BuildingPlaceResolveService],
  exports: [BuildingPlaceResolveService],
})
export class BuildingPlaceResolveModule {}
