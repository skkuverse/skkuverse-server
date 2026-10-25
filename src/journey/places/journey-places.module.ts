import { Module } from "@nestjs/common";
import { BuildingModule } from "../../building/building.module";
import { BusStopIndexModule } from "../../bus/stop-index/bus-stop-index.module";
import { SubwayStationCoordsModule } from "../../subway/station-coords/subway-station-coords.module";
import { SubwayStationsModule } from "../../subway/stations/subway-stations.module";
import { JourneyModule } from "../journey.module";
import { JourneyPlacesService } from "./journey-places.service";

@Module({
  imports: [JourneyModule, BusStopIndexModule, BuildingModule, SubwayStationsModule, SubwayStationCoordsModule],
  providers: [JourneyPlacesService],
  exports: [JourneyPlacesService],
})
export class JourneyPlacesModule {}
