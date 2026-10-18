import { Injectable } from "@nestjs/common";
import { Clock } from "../../../infra/clock";
import logger from "../../../infra/logger";
import type { JongroArrivalDoc, JongroBusPositionDoc } from "../../cache/bus-cache.document";
import { BusCacheService } from "../../cache/bus-cache.service";
import type { JongroRoute } from "../../bus.types";
import { BusRegistryService } from "../../registry/bus-registry.service";
import type { RegistryRoute } from "../../registry/bus-registry.types";
import { BusRealtimeJongroClient } from "./bus-realtime-jongro.client";
import { toJongroBusPosition } from "./bus-realtime-jongro.mapper";
import { isIdlingAtOrigin, isStationary, toArrivalsKey, toDwell, toPositionsKey } from "./bus-realtime-jongro.rules";
import type { JongroBusSighting, JongroVehicleObservation } from "./bus-realtime-jongro.types";

@Injectable()
export class BusRealtimeJongroService {
  private readonly arrivalsByCode = new Map<string, JongroArrivalDoc[]>();
  private readonly positionsByCode = new Map<string, JongroBusPositionDoc[]>();
  private readonly firstSeenAtByStationIdByCode = new Map<string, Map<string, string>>();
  private readonly observationByVehicleIdByCode = new Map<string, Map<string, JongroVehicleObservation>>();

  constructor(
    private readonly client: BusRealtimeJongroClient,
    private readonly cache: BusCacheService,
    private readonly registry: BusRegistryService,
    private readonly clock: Clock,
  ) {}

  // WHY: rejects on a missing registry, a failed fetch, a bus_cache write or a sync write, so the poller registry
  // reports the tick; the registry sync runs after both keys are written, so a held change never blocks them.
  async refresh(route: JongroRoute): Promise<void> {
    const registryRoute = await this.registry.routeOf(route.id);
    const [arrivals, sightings] = await Promise.all([this.refreshArrivals(registryRoute), this.refreshPositions(registryRoute)]);
    await this.registry.observe(registryRoute, arrivals, sightings.map((sighting) => sighting.turnaroundStationId));
  }

  // WHY: the realtime group places a route's rows by the stations this flow polls with.
  registryRouteOf(routeId: string): Promise<RegistryRoute> {
    return this.registry.routeOf(routeId);
  }

  // WHY: an api replica runs no poller: its memory is empty (undefined before a first tick) and bus_cache serves.
  async listArrivals(code: string): Promise<JongroArrivalDoc[] | undefined> {
    return (await this.cache.read(toArrivalsKey(code))) ?? this.arrivalsByCode.get(code);
  }

  async listPositions(code: string): Promise<JongroBusPositionDoc[] | undefined> {
    return (await this.cache.read(toPositionsKey(code))) ?? this.positionsByCode.get(code);
  }

  private async refreshArrivals(route: RegistryRoute): Promise<JongroArrivalDoc[]> {
    const arrivals = await this.client.fetchArrivals(route);
    this.arrivalsByCode.set(route.code, arrivals);
    await this.cache.write(toArrivalsKey(route.code), arrivals);
    return arrivals;
  }

  private async refreshPositions(route: RegistryRoute): Promise<JongroBusSighting[]> {
    const sightings = await this.client.fetchSightings(route);
    const now = this.clock.now();
    const stationaryByVehicleId = this.observeVehicles(route.code, sightings);
    const positions = sightings.flatMap((sighting) => this.toPositions(route, sighting, { now, isStationary: stationaryByVehicleId.get(sighting.vehicleId) ?? false }));
    this.positionsByCode.set(route.code, positions);
    await this.cache.write(toPositionsKey(route.code), positions);
    return sightings;
  }

  // WHY: only this tick's vehicles are remembered, so the memory never grows and a vehicle that left starts over.
  private observeVehicles(code: string, sightings: readonly JongroBusSighting[]): Map<string, boolean> {
    const previousByVehicleId = this.observationByVehicleIdByCode.get(code) ?? new Map<string, JongroVehicleObservation>();
    const observationByVehicleId = new Map<string, JongroVehicleObservation>();
    for (const sighting of sightings) {
      const previous = previousByVehicleId.get(sighting.vehicleId);
      const { sectOrd, sectDist, observedAt } = sighting;
      const stationary = isStationary(previous, { sectOrd, sectDist, observedAt }) || isIdlingAtOrigin(previous, sighting);
      observationByVehicleId.set(sighting.vehicleId, { sectOrd, sectDist, observedAt, isStationary: stationary });
    }
    this.observationByVehicleIdByCode.set(code, observationByVehicleId);
    return new Map([...observationByVehicleId].map(([vehicleId, observation]) => [vehicleId, observation.isStationary]));
  }

  private toPositions(route: RegistryRoute, sighting: JongroBusSighting, { now, isStationary: stationary }: { now: Date; isStationary: boolean }): JongroBusPositionDoc[] {
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
    return [toJongroBusPosition(sighting, station, { ...dwell, isStationary: stationary })];
  }

  private firstSeenAtByStationIdOf(code: string): Map<string, string> {
    const existing = this.firstSeenAtByStationIdByCode.get(code);
    if (existing) return existing;
    const created = new Map<string, string>();
    this.firstSeenAtByStationIdByCode.set(code, created);
    return created;
  }
}
