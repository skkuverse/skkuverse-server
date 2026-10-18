import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { SubwayEstimateModule } from "../estimate/subway-estimate.module";
import { SubwayStateModule } from "../state/subway-state.module";
import { SubwayModule } from "../subway.module";
import { SubwayTimetableModule } from "../timetable/subway-timetable.module";
import { SubwayTrackingService } from "./subway-tracking.service";

@Module({
  imports: [SubwayModule, SubwayTimetableModule, SubwayEstimateModule, SubwayStateModule],
  providers: [SubwayTrackingService, Clock],
  exports: [SubwayTrackingService],
})
export class SubwayTrackingModule {}
