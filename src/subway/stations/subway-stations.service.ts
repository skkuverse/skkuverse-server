import { Injectable } from "@nestjs/common";
import { SUBWAY_STATIONS } from "../subway.constants";
import { toServedStation } from "./subway-stations.rules";
import type { ServedStation } from "./subway-stations.types";

@Injectable()
export class SubwayStationsService {
  // WHY: resolved when Nest builds the provider, so a station on a line with no label or color fails the boot.
  private readonly stations: readonly ServedStation[] = SUBWAY_STATIONS.map(toServedStation);

  listStations(): readonly ServedStation[] {
    return this.stations;
  }
}
