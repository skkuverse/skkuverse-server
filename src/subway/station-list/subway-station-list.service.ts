import { Injectable } from "@nestjs/common";
import type { SupportedLang } from "../../infra/types";
import { SubwayStationCoordsService } from "../station-coords/subway-station-coords.service";
import { SubwayStationsService } from "../stations/subway-stations.service";
import { toListedStation } from "./subway-station-list.mapper";
import type { SubwayStationList } from "./subway-station-list.wire";

// SEE: docs/explanation/subway-architecture.md ("Invariants"): a station without coords is listed with null, never a 503.
@Injectable()
export class SubwayStationListService {
  constructor(
    private readonly stations: SubwayStationsService,
    private readonly stationCoords: SubwayStationCoordsService,
  ) {}

  async listStations(lang: SupportedLang): Promise<SubwayStationList> {
    const stations = await Promise.all(this.stations.listStations().map(async (station) => toListedStation(station, await this.stationCoords.findCoords(station.id), lang)));
    return { stations };
  }
}
