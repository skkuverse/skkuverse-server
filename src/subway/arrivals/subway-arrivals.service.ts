import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import config from "../../infra/config";
import type { SupportedLang } from "../../infra/types";
import type { SubwayArrivalsDoc } from "../subway.document";
import { SubwayRepository } from "../subway.repository";
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
  ) {}

  // WHY: each platform has its own document, so each is served fresh or from its timetable alone on its own.
  async findStationArrivals(stationId: string, lang: SupportedLang): Promise<SubwayStationArrivals | null> {
    const station = findSubwayStation(stationId);
    if (!station) return null;
    const now = this.clock.now();
    const freshById = await this.listFreshArrivals(now);
    const platformDocs = await Promise.all(
      station.platforms.map(async (platform) => ({ platform, doc: freshById.get(platform.id) ?? (await this.findScheduledArrivals(platform.id, now)) })),
    );
    return toSubwayStationArrivals(station, platformDocs, lang);
  }

  // WHY: with SUBWAY=off nothing writes the state, so the timetable alone is served without reading it.
  private async listFreshArrivals(now: Date): Promise<ReadonlyMap<string, SubwayArrivalsDoc>> {
    if (!config.subway.enabled) return new Map();
    const docs = await this.repository.listArrivals();
    return new Map(docs.filter((doc) => isFreshState(doc.generatedAt, now)).map((doc) => [doc._id, doc]));
  }

  // WHY: unreachable for a registered platform: assertTimetablesCover stops the boot when one has no table.
  private async findScheduledArrivals(platformId: string, now: Date): Promise<SubwayArrivalsDoc> {
    const doc = await this.tracking.findScheduledArrivals(platformId, now);
    if (!doc) throw new Error(`subway: no timetable-only arrivals for ${platformId}`);
    return doc;
  }
}
