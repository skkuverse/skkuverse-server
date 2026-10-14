import { Controller, Get, Param } from "@nestjs/common";
import type { WithMeta } from "../../http/response.types";
import { BusStationService } from "./bus-station.service";
import type { StationArrivals, StationArrivalsMeta } from "./bus-station.wire";

@Controller("bus/station")
export class BusStationController {
  constructor(private readonly station: BusStationService) {}

  @Get(":stationId")
  getStation(@Param("stationId") stationId: string): Promise<StationArrivals | WithMeta<StationArrivals, StationArrivalsMeta>> {
    return this.station.listArrivals(stationId);
  }
}
