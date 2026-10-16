import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { SubwayModule } from "../subway.module";
import { SubwayTrackingModule } from "../tracking/subway-tracking.module";
import { SubwayArrivalsController } from "./subway-arrivals.controller";
import { SubwayArrivalsService } from "./subway-arrivals.service";

@Module({
  imports: [SubwayModule, SubwayTrackingModule],
  controllers: [SubwayArrivalsController],
  providers: [SubwayArrivalsService, Clock],
})
export class SubwayArrivalsModule {}
