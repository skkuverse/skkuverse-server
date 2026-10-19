import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { BusScheduleContentRepository } from "./bus-schedule-content.repository";
import { BusScheduleContentService } from "./bus-schedule-content.service";

@Module({
  providers: [BusScheduleContentService, BusScheduleContentRepository, Clock],
  exports: [BusScheduleContentService],
})
export class BusScheduleContentModule {}
