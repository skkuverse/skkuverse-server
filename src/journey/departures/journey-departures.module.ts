import { Module } from "@nestjs/common";
import { BusDeparturesTimetableModule } from "../../bus/departures/timetable/bus-departures-timetable.module";
import { BusDeparturesTopisModule } from "../../bus/departures/topis/bus-departures-topis.module";
import { SubwayTimetableDeparturesModule } from "../../subway/timetable/departures/subway-timetable-departures.module";
import { JourneyModule } from "../journey.module";
import { JourneyDeparturesService } from "./journey-departures.service";

@Module({
  imports: [JourneyModule, BusDeparturesTimetableModule, BusDeparturesTopisModule, SubwayTimetableDeparturesModule],
  providers: [JourneyDeparturesService],
  exports: [JourneyDeparturesService],
})
export class JourneyDeparturesModule {}
