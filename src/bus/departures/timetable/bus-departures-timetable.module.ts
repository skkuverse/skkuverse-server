import { Module } from "@nestjs/common";
import { BusEtaSmartModule } from "../../eta/smart/bus-eta-smart.module";
import { BusStopsModule } from "../../stops/bus-stops.module";
import { BusDeparturesModule } from "../bus-departures.module";
import { BusDeparturesTimetableService } from "./bus-departures-timetable.service";

@Module({
  imports: [BusDeparturesModule, BusEtaSmartModule, BusStopsModule],
  providers: [BusDeparturesTimetableService],
  exports: [BusDeparturesTimetableService],
})
export class BusDeparturesTimetableModule {}
