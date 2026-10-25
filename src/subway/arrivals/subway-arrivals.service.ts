import { Injectable } from "@nestjs/common";
import { withMeta } from "../../http/response.interceptor";
import type { WithMeta } from "../../http/response.types";
import { Clock } from "../../infra/clock";
import type { SupportedLang } from "../../infra/types";
import { toKstInstant } from "../../shared/kst-date.util";
import { SubwayPlatformArrivalsService } from "../platform-arrivals/subway-platform-arrivals.service";
import { SubwayStationCoordsService } from "../station-coords/subway-station-coords.service";
import { SubwayTopologyService } from "../topology/subway-topology.service";
import type { StopCall } from "../../shared/call.types";
import { toPlatformCalls, toSubwayStationArrivals } from "./subway-arrivals.mapper";
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

  // WHY: the calls this route serves at one platform, so a journey ride boards a stored train by the same call (ADR 0022, D6).
  async listPlatformCalls(platformId: string): Promise<StopCall[]> {
    const { registry } = await this.topology.current();
    const platform = registry.stations.flatMap((station) => station.platforms).find((candidate) => candidate.id === platformId);
    if (!platform) return [];
    const platformDocs = await this.platformArrivals.listPlatformArrivals([platform]);
    return platformDocs.flatMap(toPlatformCalls);
  }
}
