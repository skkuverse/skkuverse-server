import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { SubwayStationCoordsModule } from "../station-coords/subway-station-coords.module";
import { SubwayPlatformArrivalsModule } from "../platform-arrivals/subway-platform-arrivals.module";
import { SubwayTopologyModule } from "../topology/subway-topology.module";
import { SubwayArrivalsController } from "./subway-arrivals.controller";
import { SubwayArrivalsService } from "./subway-arrivals.service";

@Module({
  imports: [SubwayTopologyModule, SubwayStationCoordsModule, SubwayPlatformArrivalsModule],
  controllers: [SubwayArrivalsController],
  providers: [SubwayArrivalsService, Clock],
  exports: [SubwayArrivalsService],
})
export class SubwayArrivalsModule {}
