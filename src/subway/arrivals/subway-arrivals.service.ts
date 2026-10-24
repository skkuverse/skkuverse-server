import { Injectable } from "@nestjs/common";
import { withMeta } from "../../http/response.interceptor";
import type { WithMeta } from "../../http/response.types";
import { Clock } from "../../infra/clock";
import type { SupportedLang } from "../../infra/types";
import { toKstInstant } from "../../shared/kst-date.util";
import { SubwayPlatformArrivalsService } from "../platform-arrivals/subway-platform-arrivals.service";
import { SubwayStationCoordsService } from "../station-coords/subway-station-coords.service";
import { SubwayTopologyService } from "../topology/subway-topology.service";
import { toSubwayStationArrivals } from "./subway-arrivals.mapper";
import { findSubwayStation } from "./subway-arrivals.rules";
import type { SubwayStationArrivals, SubwayStationArrivalsMeta } from "./subway-arrivals.wire";

@Injectable()
export class SubwayArrivalsService {
  constructor(
    private readonly topology: SubwayTopologyService,
    private readonly stationCoords: SubwayStationCoordsService,
    private readonly platformArrivals: SubwayPlatformArrivalsService,
    private readonly clock: Clock,
  ) {}

  // WHY: the topology comes first, so its 503 needs no read of the state.
  async findStationArrivals(stationId: string, lang: SupportedLang): Promise<WithMeta<SubwayStationArrivals, SubwayStationArrivalsMeta> | null> {
    const { registry } = await this.topology.current();
    const station = findSubwayStation(stationId, registry);
    if (!station) return null;
    const coords = await this.stationCoords.findCoords(station.id);
    const platformDocs = await this.platformArrivals.listPlatformArrivals(station.platforms);
    const arrivals = toSubwayStationArrivals(station, platformDocs, { lang, registry, coords });
    return withMeta(arrivals, { serverNow: toKstInstant(this.clock.now().getTime()) });
  }
}
