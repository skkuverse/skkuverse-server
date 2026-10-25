import { Injectable } from "@nestjs/common";
import { BusDeparturesTimetableService } from "../../bus/departures/timetable/bus-departures-timetable.service";
import type { DepartureBoard, DepartureQuery } from "../../shared/departure.types";
import type { JourneySourceId } from "../journey.types";

// SEE: docs/explanation/journey-architecture.md ("Structure"): the registry from a dataset line's source to its door.
@Injectable()
export class JourneyDeparturesService {
  constructor(private readonly timetable: BusDeparturesTimetableService) {}

  // WHY: a Record over every source id, so a source added to JOURNEY_SOURCE_IDS fails `tsc` until it is mapped here.
  listDepartures(source: JourneySourceId, query: DepartureQuery): Promise<DepartureBoard> {
    const doorBySource: Readonly<Record<JourneySourceId, () => Promise<DepartureBoard>>> = { busTimetable: () => this.timetable.listDepartures(query) };
    return doorBySource[source]();
  }
}
