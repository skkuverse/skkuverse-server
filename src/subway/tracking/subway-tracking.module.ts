import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { SubwayEstimateModule } from "../estimate/subway-estimate.module";
import { SubwayModule } from "../subway.module";
import { SubwayTimetableModule } from "../timetable/subway-timetable.module";
import { SubwayTrackingService } from "./subway-tracking.service";

@Module({
  imports: [SubwayModule, SubwayTimetableModule, SubwayEstimateModule],
  providers: [SubwayTrackingService, Clock],
  exports: [SubwayTrackingService],
})
export class SubwayTrackingModule {}
