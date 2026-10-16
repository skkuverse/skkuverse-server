import { Module } from "@nestjs/common";
import { HolidaysModule } from "../../holidays/holidays.module";
import { SubwayModule } from "../subway.module";
import { SubwayTimetableService } from "./subway-timetable.service";

@Module({
  imports: [SubwayModule, HolidaysModule],
  providers: [SubwayTimetableService],
  exports: [SubwayTimetableService],
})
export class SubwayTimetableModule {}
