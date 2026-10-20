import { Injectable } from "@nestjs/common";
import { SUBWAY_STATIONS } from "../subway.constants";
import { toSubwayLine } from "../subway.rules";
import { toServedStation } from "./subway-stations.rules";
import type { ServedStation } from "./subway-stations.types";

@Injectable()
export class SubwayStationsService {
  private readonly stations: readonly ServedStation[] = SUBWAY_STATIONS.map((station) => toServedStation(station, (code) => toSubwayLine(code)));

  listStations(): readonly ServedStation[] {
    return this.stations;
  }
}
