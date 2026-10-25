import { Module } from "@nestjs/common";
import { SubwayTimetableModule } from "../subway-timetable.module";
import { SubwayTimetableDeparturesService } from "./subway-timetable-departures.service";

@Module({
  imports: [SubwayTimetableModule],
  providers: [SubwayTimetableDeparturesService],
  exports: [SubwayTimetableDeparturesService],
})
export class SubwayTimetableDeparturesModule {}
