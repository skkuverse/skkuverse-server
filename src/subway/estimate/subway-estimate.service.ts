import { Injectable } from "@nestjs/common";
import { SubwayCountdownService } from "../countdown/subway-countdown.service";
import { toStationArrivals } from "./subway-estimate.rules";
import type { EstimateInput, StationArrivals, TrainArrival } from "./subway-estimate.types";

// SEE: docs/decisions/0010-server-architecture.md (D1): the door the tracking and arrivals flows estimate
// through, which siblings import only as a .module or a .service.
@Injectable()
export class SubwayEstimateService {
  constructor(private readonly countdown: SubwayCountdownService) {}

  estimateArrivals(input: EstimateInput): StationArrivals {
    return toStationArrivals({ ...input, countdownRows: this.countdown.listFirstPublishedRows(input.countdownRows) });
  }

  // WHY: the countdown memory is advanced by the tracker's ticks only, so a timetable-only document built between
  // them, as an api process serving a stale state does, never resets it.
  listScheduledArrivals(input: Pick<EstimateInput, "stationId" | "direction" | "trains" | "now">): TrainArrival[] {
    return toStationArrivals({ ...input, histories: new Map(), countdownRows: [] }).arrivals;
  }
}
