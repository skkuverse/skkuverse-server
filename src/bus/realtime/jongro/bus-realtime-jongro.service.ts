import { Injectable } from "@nestjs/common";
import { Clock } from "../../../infra/clock";
import logger from "../../../infra/logger";
import type { CachedJongroArrivalDoc, JongroArrivalDoc, JongroBusPositionDoc } from "../../cache/bus-cache.document";
import { BusCacheService } from "../../cache/bus-cache.service";
import type { JongroRoute } from "../../bus.types";
import { BusRealtimeJongroClient } from "./bus-realtime-jongro.client";
import { toJongroBusPosition } from "./bus-realtime-jongro.mapper";
import { toArrivalsKey, toDwell, toPositionsKey, toRegistryDrift } from "./bus-realtime-jongro.rules";
import type { JongroBusSighting } from "./bus-realtime-jongro.types";

@Injectable()
export class BusRealtimeJongroService {
  private readonly arrivalsByCode = new Map<string, JongroArrivalDoc[]>();
  private readonly positionsByCode = new Map<string, JongroBusPositionDoc[]>();
  private readonly firstSeenAtByStationIdByCode = new Map<string, Map<string, string>>();
  private readonly driftWarnedCodes = new Set<string>();

  constructor(
    private readonly client: BusRealtimeJongroClient,
    private readonly cache: BusCacheService,
    private readonly clock: Clock,
  ) {}

  // WHY: rejects on a failed fetch or bus_cache write, so the poller registry reports the tick.
  async refresh(route: JongroRoute): Promise<void> {
    await Promise.all([this.refreshArrivals(route), this.refreshPositions(route)]);
  }

  // WHY: an api replica runs no poller: its memory is empty (undefined before a first tick) and bus_cache serves.
  async listArrivals(code: string): Promise<CachedJongroArrivalDoc[] | undefined> {
    return (await this.cache.read(toArrivalsKey(code))) ?? this.arrivalsByCode.get(code);
  }

  async listPositions(code: string): Promise<JongroBusPositionDoc[] | undefined> {
    return (await this.cache.read(toPositionsKey(code))) ?? this.positionsByCode.get(code);
  }

  private async refreshArrivals(route: JongroRoute): Promise<void> {
    const arrivals = await this.client.fetchArrivals(route);
    this.warnOnRegistryDrift(route, arrivals);
    this.arrivalsByCode.set(route.code, arrivals);
    await this.cache.write(toArrivalsKey(route.code), arrivals);
  }

  private async refreshPositions(route: JongroRoute): Promise<void> {
    const sightings = await this.client.fetchSightings(route);
    const now = this.clock.now();
    const positions = sightings.flatMap((sighting) => this.toPositions(route, sighting, now));
    this.positionsByCode.set(route.code, positions);
    await this.cache.write(toPositionsKey(route.code), positions);
  }

  private toPositions(route: JongroRoute, sighting: JongroBusSighting, now: Date): JongroBusPositionDoc[] {
    const station = route.mapping[sighting.stationId];
    if (!station) {
      logger.debug(
        { event: "bus.jongro.unmapped_station", lastStnId: sighting.stationId, code: route.code },
        "Unmapped station ID",
      );
      return [];
    }
    const firstSeenAtByStationId = this.firstSeenAtByStationIdOf(route.code);
    const dwell = toDwell(firstSeenAtByStationId.get(sighting.stationId), now);
    firstSeenAtByStationId.set(sighting.stationId, dwell.firstSeenAt);
    return [toJongroBusPosition(sighting, station, dwell)];
  }

  private firstSeenAtByStationIdOf(code: string): Map<string, string> {
    const existing = this.firstSeenAtByStationIdByCode.get(code);
    if (existing) return existing;
    const created = new Map<string, string>();
    this.firstSeenAtByStationIdByCode.set(code, created);
    return created;
  }

  // WHY: once per route per process; a drifted registry puts buses and ETAs on the wrong stop. An empty list
  // ("4", no result) names no stop, so it says nothing about the registry.
  private warnOnRegistryDrift(route: JongroRoute, arrivals: readonly JongroArrivalDoc[]): void {
    if (arrivals.length === 0 || this.driftWarnedCodes.has(route.code)) return;
    const drift = toRegistryDrift(route, arrivals);
    if (!drift) return;
    this.driftWarnedCodes.add(route.code);
    logger.warn(
      { event: "bus.jongro.registry_drift", code: route.code, ...drift },
      "jongro-routes.json has drifted from TOPIS — resync the registry",
    );
  }
}
