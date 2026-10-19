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
import { isIdlingAtOrigin, isStationary, toArrivalsKey, toAtStopSince, toDwell, toPositionsKey } from "./bus-realtime-jongro.rules";
import type { JongroBusSighting, JongroVehicleObservation } from "./bus-realtime-jongro.types";

@Injectable()
export class BusRealtimeJongroService {
  private readonly firstSeenAtByStationIdByCode = new Map<string, Map<string, string>>();
  private readonly observationByVehicleIdByCode = new Map<string, Map<string, JongroVehicleObservation>>();

  constructor(
    private readonly client: BusRealtimeJongroClient,
    private readonly cache: BusCacheService,
    private readonly registry: BusRegistryService,
    private readonly clock: Clock,
  ) {}

  // WHY: rejects on a failed fetch, a bus_cache write, a registry write or a route still bootstrapping, so the poller
  // registry reports the tick; the registry sync runs after both keys are written, so a held change never blocks them.
  async refresh(route: JongroRoute): Promise<void> {
    const registryRoute = await this.registry.findRouteOf(route.id);
    if (registryRoute === null) return this.bootstrapRegistry(route);
    const [arrivals, sightings] = await Promise.all([this.refreshArrivals(registryRoute), this.refreshPositions(registryRoute)]);
    await this.registry.observe(registryRoute, arrivals, sightings.map((sighting) => sighting.turnaroundStationId));
  }

  // WHY: the realtime group places a route's rows by the stations this flow polls with.
  registryRouteOf(routeId: string): Promise<RegistryRoute> {
    return this.registry.routeOf(routeId);
  }

  // WHY: never the poller's own memory, so combined answers as an api replica does (ADR 0012, D1).
  async listArrivals(code: string): Promise<JongroArrivalDoc[] | undefined> {
    return (await this.cache.read(toArrivalsKey(code))) ?? undefined;
  }

  async listPositions(code: string): Promise<JongroBusPositionDoc[] | undefined> {
    return (await this.cache.read(toPositionsKey(code))) ?? undefined;
  }

  // WHY: with no stations a bus has no stop to sit at, so the tick only observes TOPIS until the route is stored.
  private async bootstrapRegistry(route: JongroRoute): Promise<void> {
    const [arrivals, sightings] = await Promise.all([this.client.fetchArrivals(route), this.client.fetchSightings(route)]);
    await this.registry.bootstrap(route, arrivals, sightings.map((sighting) => sighting.turnaroundStationId));
  }

  private async refreshArrivals(route: RegistryRoute): Promise<JongroArrivalDoc[]> {
    const arrivals = await this.client.fetchArrivals(route);
    await this.cache.write(toArrivalsKey(route.code), arrivals);
    return arrivals;
  }

  private async refreshPositions(route: RegistryRoute): Promise<JongroBusSighting[]> {
    const sightings = await this.client.fetchSightings(route);
    const now = this.clock.now();
    const observationByVehicleId = this.observeVehicles(route.code, sightings);
    const positions = sightings.flatMap((sighting) => this.toPositions(route, sighting, { now, observation: observationByVehicleId.get(sighting.vehicleId) }));
    await this.cache.write(toPositionsKey(route.code), positions);
    return sightings;
  }

  // WHY: only this tick's vehicles are remembered, so the memory never grows and a vehicle that left starts over.
  private observeVehicles(code: string, sightings: readonly JongroBusSighting[]): Map<string, JongroVehicleObservation> {
    const previousByVehicleId = this.observationByVehicleIdByCode.get(code) ?? new Map<string, JongroVehicleObservation>();
    const observationByVehicleId = new Map<string, JongroVehicleObservation>();
    for (const sighting of sightings) {
      const previous = previousByVehicleId.get(sighting.vehicleId);
      const { sectOrd, sectDist, observedAt } = sighting;
      const stationary = isStationary(previous, { sectOrd, sectDist, observedAt }) || isIdlingAtOrigin(previous, sighting);
      const atStopSince = toAtStopSince(previous, sighting);
      observationByVehicleId.set(sighting.vehicleId, { sectOrd, sectDist, observedAt, isStationary: stationary, ...(atStopSince && { atStopSince }) });
    }
    this.observationByVehicleIdByCode.set(code, observationByVehicleId);
    return observationByVehicleId;
  }

  private toPositions(route: RegistryRoute, sighting: JongroBusSighting, { now, observation }: { now: Date; observation: JongroVehicleObservation | undefined }): JongroBusPositionDoc[] {
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
    const atStopSince = observation?.atStopSince;
    return [toJongroBusPosition(sighting, station, { ...dwell, isStationary: observation?.isStationary ?? false, ...(atStopSince && { atStopSince }) })];
  }

  private firstSeenAtByStationIdOf(code: string): Map<string, string> {
    const existing = this.firstSeenAtByStationIdByCode.get(code);
    if (existing) return existing;
    const created = new Map<string, string>();
    this.firstSeenAtByStationIdByCode.set(code, created);
    return created;
  }
}
