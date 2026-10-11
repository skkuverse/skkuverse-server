import { Module } from "@nestjs/common";
import { BuildingModule } from "../../building/building.module";
import { MapModule } from "../map.module";
import { MapCampusController } from "./map-campus.controller";
import { MapCampusService } from "./map-campus.service";

@Module({
  imports: [MapModule, BuildingModule],
  controllers: [MapCampusController],
  providers: [MapCampusService],
})
export class MapCampusModule {}
