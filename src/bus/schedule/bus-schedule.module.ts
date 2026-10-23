import { Module } from "@nestjs/common";
import { CalendarModule } from "../../calendar/calendar.module";
import { Clock } from "../../infra/clock";
import { BusScheduleContentModule } from "../schedule-content/bus-schedule-content.module";
import { BusScheduleController } from "./bus-schedule.controller";
import { BusScheduleRepository } from "./bus-schedule.repository";
import { BusScheduleService } from "./bus-schedule.service";

@Module({
  imports: [CalendarModule, BusScheduleContentModule],
  controllers: [BusScheduleController],
  providers: [BusScheduleService, BusScheduleRepository, Clock],
  exports: [BusScheduleService],
})
export class BusScheduleModule {}
