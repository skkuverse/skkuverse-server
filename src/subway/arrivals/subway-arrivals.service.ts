import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import type { SupportedLang } from "../../infra/types";
import type { SubwayArrivalsDoc } from "../subway.document";
import { SubwayRepository } from "../subway.repository";
import { SubwayTopologyService } from "../topology/subway-topology.service";
import { SubwayTrackingService } from "../tracking/subway-tracking.service";
import { toSubwayStationArrivals } from "./subway-arrivals.mapper";
import { findSubwayStation, isFreshState } from "./subway-arrivals.rules";
import type { SubwayStationArrivals } from "./subway-arrivals.wire";

@Injectable()
export class SubwayArrivalsService {
  constructor(
    private readonly repository: SubwayRepository,
    private readonly tracking: SubwayTrackingService,
    private readonly clock: Clock,
    private readonly topology: SubwayTopologyService,
  ) {}

  // WHY: each platform has its own document, so each is served fresh or from its timetable alone on its own; the
  // topology comes first, so its 503 needs no read of the state.
  async findStationArrivals(stationId: string, lang: SupportedLang): Promise<SubwayStationArrivals | null> {
    const { registry } = await this.topology.current();
    const station = findSubwayStation(stationId, registry);
    if (!station) return null;
    const now = this.clock.now();
    const freshById = await this.listFreshArrivals(now);
    const platformDocs = await Promise.all(
      station.platforms.map(async (platform) => ({ platform, doc: freshById.get(platform.id) ?? (await this.findScheduledArrivals(platform.id, now)) })),
    );
    return toSubwayStationArrivals(station, platformDocs, { lang, registry });
  }

  // WHY: read whatever SUBWAY says: the switch stops only the poller, and another container may run it (ADR 0012, D5).
  private async listFreshArrivals(now: Date): Promise<ReadonlyMap<string, SubwayArrivalsDoc>> {
    const docs = await this.repository.listArrivals();
    return new Map(docs.filter((doc) => isFreshState(doc.generatedAt, now)).map((doc) => [doc._id, doc]));
  }

  // WHY: unreachable for a served platform: the timetable door throws the 503 SUBWAY_TIMETABLES_UNAVAILABLE when it has no table.
  private async findScheduledArrivals(platformId: string, now: Date): Promise<SubwayArrivalsDoc> {
    const doc = await this.tracking.findScheduledArrivals(platformId, now);
    if (!doc) throw new Error(`subway: no timetable-only arrivals for ${platformId}`);
    return doc;
  }
}
