import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { SubwayModule } from "../subway.module";
import { SubwayTrackingModule } from "../tracking/subway-tracking.module";
import { SubwayHistoryController } from "./subway-history.controller";
import { SubwayHistoryRepository } from "./subway-history.repository";
import { SubwayHistoryService } from "./subway-history.service";

@Module({
  imports: [SubwayModule, SubwayTrackingModule],
  controllers: [SubwayHistoryController],
  providers: [SubwayHistoryService, SubwayHistoryRepository, Clock],
})
export class SubwayHistoryModule {}
