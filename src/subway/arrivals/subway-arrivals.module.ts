import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { SubwayModule } from "../subway.module";
import { SubwayTopologyModule } from "../topology/subway-topology.module";
import { SubwayTrackingModule } from "../tracking/subway-tracking.module";
import { SubwayArrivalsController } from "./subway-arrivals.controller";
import { SubwayArrivalsService } from "./subway-arrivals.service";

@Module({
  imports: [SubwayModule, SubwayTopologyModule, SubwayTrackingModule],
  controllers: [SubwayArrivalsController],
  providers: [SubwayArrivalsService, Clock],
})
export class SubwayArrivalsModule {}
