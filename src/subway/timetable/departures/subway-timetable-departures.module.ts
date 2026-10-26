import { Module } from "@nestjs/common";
import { SubwayArrivalsModule } from "../../arrivals/subway-arrivals.module";
import { SubwayStationCoordsModule } from "../../station-coords/subway-station-coords.module";
import { SubwayTopologyModule } from "../../topology/subway-topology.module";
import { SubwayTimetableModule } from "../subway-timetable.module";
import { SubwayTimetableDeparturesService } from "./subway-timetable-departures.service";

@Module({
  imports: [SubwayTimetableModule, SubwayArrivalsModule, SubwayTopologyModule, SubwayStationCoordsModule],
  providers: [SubwayTimetableDeparturesService],
  exports: [SubwayTimetableDeparturesService],
})
export class SubwayTimetableDeparturesModule {}
