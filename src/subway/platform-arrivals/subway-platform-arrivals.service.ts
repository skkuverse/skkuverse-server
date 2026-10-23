import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import type { SubwayArrivalsDoc } from "../subway.document";
import { SubwayRepository } from "../subway.repository";
import type { SubwayPlatform } from "../subway.types";
import { SubwayTrackingService } from "../tracking/subway-tracking.service";
import { isFreshState } from "./subway-platform-arrivals.rules";
import type { PlatformArrivals } from "./subway-platform-arrivals.types";

@Injectable()
export class SubwayPlatformArrivalsService {
  constructor(
    private readonly repository: SubwayRepository,
    private readonly tracking: SubwayTrackingService,
    private readonly clock: Clock,
  ) {}

  // WHY: each platform has its own document, so each is served fresh or from its timetable alone on its own.
  async listPlatformArrivals(platforms: readonly SubwayPlatform[]): Promise<PlatformArrivals[]> {
    const now = this.clock.now();
    const freshById = await this.listFreshArrivals(now);
    return Promise.all(platforms.map(async (platform) => ({ platform, doc: freshById.get(platform.id) ?? (await this.findScheduledArrivals(platform.id, now)) })));
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
