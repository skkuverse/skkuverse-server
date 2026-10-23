import { Module } from "@nestjs/common";
import { CalendarModule } from "../../calendar/calendar.module";
import { Clock } from "../../infra/clock";
import { SubwayModule } from "../subway.module";
import { SubwayTimetableRepository } from "./subway-timetable.repository";
import { SubwayTimetableService } from "./subway-timetable.service";

@Module({
  imports: [SubwayModule, CalendarModule],
  providers: [SubwayTimetableService, SubwayTimetableRepository, Clock],
  exports: [SubwayTimetableService],
})
export class SubwayTimetableModule {}
