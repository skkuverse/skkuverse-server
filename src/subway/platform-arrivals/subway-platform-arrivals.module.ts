import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { SubwayModule } from "../subway.module";
import { SubwayTrackingModule } from "../tracking/subway-tracking.module";
import { SubwayPlatformArrivalsService } from "./subway-platform-arrivals.service";

@Module({
  imports: [SubwayModule, SubwayTrackingModule],
  providers: [SubwayPlatformArrivalsService, Clock],
  exports: [SubwayPlatformArrivalsService],
})
export class SubwayPlatformArrivalsModule {}
