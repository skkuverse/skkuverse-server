import { Injectable } from "@nestjs/common";
import { toStationArrivals } from "./subway-estimate.rules";
import type { EstimateInput, StationArrivals } from "./subway-estimate.types";

// SEE: docs/decisions/0010-server-architecture.md (D1): the door the tracking and arrivals flows estimate
// through, which siblings import only as a .module or a .service.
@Injectable()
export class SubwayEstimateService {
  estimateArrivals(input: EstimateInput): StationArrivals {
    return toStationArrivals(input);
  }
}
