import { Module } from "@nestjs/common";
import { HolidaysModule } from "../../holidays/holidays.module";
import { Clock } from "../../infra/clock";
import { SubwayModule } from "../subway.module";
import { SubwayTimetableRepository } from "./subway-timetable.repository";
import { SubwayTimetableService } from "./subway-timetable.service";

@Module({
  imports: [SubwayModule, HolidaysModule],
  providers: [SubwayTimetableService, SubwayTimetableRepository, Clock],
  exports: [SubwayTimetableService],
})
export class SubwayTimetableModule {}
