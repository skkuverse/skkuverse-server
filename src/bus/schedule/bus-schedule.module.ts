import { Module } from "@nestjs/common";
import { HolidaysModule } from "../../holidays/holidays.module";
import { Clock } from "../../infra/clock";
import { BusScheduleController } from "./bus-schedule.controller";
import { BusScheduleRepository } from "./bus-schedule.repository";
import { BusScheduleService } from "./bus-schedule.service";

@Module({
  imports: [HolidaysModule],
  controllers: [BusScheduleController],
  providers: [BusScheduleService, BusScheduleRepository, Clock],
  exports: [BusScheduleService],
})
export class BusScheduleModule {}
