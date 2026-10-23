import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { SubwayStationCoordsRepository } from "./subway-station-coords.repository";
import { SubwayStationCoordsService } from "./subway-station-coords.service";

@Module({
  providers: [SubwayStationCoordsService, SubwayStationCoordsRepository, Clock],
  exports: [SubwayStationCoordsService],
})
export class SubwayStationCoordsModule {}
