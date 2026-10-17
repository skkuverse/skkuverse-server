import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { SubwayModule } from "../subway.module";
import { SubwayTrackingModule } from "../tracking/subway-tracking.module";
import { SubwayMatchingService } from "./subway-matching.service";

@Module({
  imports: [SubwayModule, SubwayTrackingModule],
  providers: [SubwayMatchingService, Clock],
})
export class SubwayMatchingModule {}
