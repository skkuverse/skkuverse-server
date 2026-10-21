import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { SubwayStationsModule } from "../../subway/stations/subway-stations.module";
import { BusStopsRepository } from "./bus-stops.repository";
import { BusStopsService } from "./bus-stops.service";

@Module({
  imports: [SubwayStationsModule],
  providers: [BusStopsService, BusStopsRepository, Clock],
  exports: [BusStopsService],
})
export class BusStopsModule {}
