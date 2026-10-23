import { Module } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { BusScheduleContentModule } from "../schedule-content/bus-schedule-content.module";
import { BusScheduleController } from "./bus-schedule.controller";
import { BusScheduleRepository } from "./bus-schedule.repository";
import { BusScheduleService } from "./bus-schedule.service";

@Module({
  imports: [BusScheduleContentModule],
  controllers: [BusScheduleController],
  providers: [BusScheduleService, BusScheduleRepository, Clock],
  exports: [BusScheduleService],
})
export class BusScheduleModule {}
