import { Injectable } from "@nestjs/common";
import { SubwayCountdownService } from "../countdown/subway-countdown.service";
import { toStationArrivals } from "./subway-estimate.rules";
import type { EstimateInput, StationArrivals } from "./subway-estimate.types";

// SEE: docs/decisions/0010-server-architecture.md (D1): the door the tracking and arrivals flows estimate
// through, which siblings import only as a .module or a .service.
@Injectable()
export class SubwayEstimateService {
  // WHY: Nest injects SubwayCountdownModule's instance; the default lets the sibling flows' specs build the
  // estimate by hand (`new SubwayEstimateService()`), each with a countdown memory of its own.
  constructor(private readonly countdown: SubwayCountdownService = new SubwayCountdownService()) {}

  estimateArrivals(input: EstimateInput): StationArrivals {
    return toStationArrivals({ ...input, countdownRows: this.countdown.listCountingRows(input.countdownRows, input.now) });
  }
}
