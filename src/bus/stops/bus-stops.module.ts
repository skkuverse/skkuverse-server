import { Module } from "@nestjs/common";
import { SubwayStationsModule } from "../../subway/stations/subway-stations.module";
import { BusStopsService } from "./bus-stops.service";

@Module({
  imports: [SubwayStationsModule],
  providers: [BusStopsService],
  exports: [BusStopsService],
})
export class BusStopsModule {}
