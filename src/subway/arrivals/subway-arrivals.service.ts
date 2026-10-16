import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import config from "../../infra/config";
import type { SupportedLang } from "../../infra/types";
import type { SubwayArrivalsDoc } from "../subway.document";
import { SubwayRepository } from "../subway.repository";
import { findSubwayStation } from "../subway.rules";
import { SubwayTrackingService } from "../tracking/subway-tracking.service";
import { toSubwayStationArrivals } from "./subway-arrivals.mapper";
import { isFreshState } from "./subway-arrivals.rules";
import type { SubwayStationArrivals } from "./subway-arrivals.wire";

@Injectable()
export class SubwayArrivalsService {
  constructor(
    private readonly repository: SubwayRepository,
    private readonly tracking: SubwayTrackingService,
    private readonly clock: Clock,
  ) {}

  async findStationArrivals(stationId: string, lang: SupportedLang): Promise<SubwayStationArrivals | null> {
    const station = findSubwayStation(stationId);
    if (!station) return null;
    const now = this.clock.now();
    const doc = (await this.findFreshArrivals(station.id, now)) ?? (await this.tracking.findScheduledArrivals(station.id, now));
    return doc && toSubwayStationArrivals(station, doc, lang);
  }

  // WHY: with SUBWAY=off nothing writes the state, so the timetable alone is served without reading it.
  private async findFreshArrivals(stationId: string, now: Date): Promise<SubwayArrivalsDoc | null> {
    if (!config.subway.enabled) return null;
    const doc = (await this.repository.listArrivals()).find((stored) => stored._id === stationId);
    return doc && isFreshState(doc.generatedAt, now) ? doc : null;
  }
}
