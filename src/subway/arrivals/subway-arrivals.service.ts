import { Injectable } from "@nestjs/common";
import type { SupportedLang } from "../../infra/types";
import { SubwayPlatformArrivalsService } from "../platform-arrivals/subway-platform-arrivals.service";
import { SubwayStationCoordsService } from "../station-coords/subway-station-coords.service";
import { SubwayTopologyService } from "../topology/subway-topology.service";
import { toSubwayStationArrivals } from "./subway-arrivals.mapper";
import { findSubwayStation } from "./subway-arrivals.rules";
import type { SubwayStationArrivals } from "./subway-arrivals.wire";

@Injectable()
export class SubwayArrivalsService {
  constructor(
    private readonly topology: SubwayTopologyService,
    private readonly stationCoords: SubwayStationCoordsService,
    private readonly platformArrivals: SubwayPlatformArrivalsService,
  ) {}

  // WHY: the topology comes first, so its 503 needs no read of the state.
  async findStationArrivals(stationId: string, lang: SupportedLang): Promise<SubwayStationArrivals | null> {
    const { registry } = await this.topology.current();
    const station = findSubwayStation(stationId, registry);
    if (!station) return null;
    const coords = await this.stationCoords.findCoords(station.id);
    const platformDocs = await this.platformArrivals.listPlatformArrivals(station.platforms);
    return toSubwayStationArrivals(station, platformDocs, { lang, registry, coords });
  }
}
