import { Module } from "@nestjs/common";
import { SubwayArrivalsModule } from "../../arrivals/subway-arrivals.module";
import { SubwayTimetableModule } from "../subway-timetable.module";
import { SubwayTimetableDeparturesService } from "./subway-timetable-departures.service";

@Module({
  imports: [SubwayTimetableModule, SubwayArrivalsModule],
  providers: [SubwayTimetableDeparturesService],
  exports: [SubwayTimetableDeparturesService],
})
export class SubwayTimetableDeparturesModule {}
