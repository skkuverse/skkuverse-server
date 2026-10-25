import { Module } from "@nestjs/common";
import { BusDeparturesTimetableModule } from "../../bus/departures/timetable/bus-departures-timetable.module";
import { JourneyModule } from "../journey.module";
import { JourneyDeparturesService } from "./journey-departures.service";

@Module({
  imports: [JourneyModule, BusDeparturesTimetableModule],
  providers: [JourneyDeparturesService],
  exports: [JourneyDeparturesService],
})
export class JourneyDeparturesModule {}
