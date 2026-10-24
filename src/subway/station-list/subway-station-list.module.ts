import { Module } from "@nestjs/common";
import { SubwayStationCoordsModule } from "../station-coords/subway-station-coords.module";
import { SubwayStationsModule } from "../stations/subway-stations.module";
import { SubwayStationListController } from "./subway-station-list.controller";
import { SubwayStationListService } from "./subway-station-list.service";

@Module({
  imports: [SubwayStationsModule, SubwayStationCoordsModule],
  controllers: [SubwayStationListController],
  providers: [SubwayStationListService],
})
export class SubwayStationListModule {}
