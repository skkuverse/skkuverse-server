import { Injectable } from "@nestjs/common";
import { createCachedLoader, type CachedLoader } from "../../infra/cached-loader";
import { createLogThrottle } from "../../shared/log-throttle.util";
import { Clock } from "../../infra/clock";
import logger from "../../infra/logger";
import { TOPIS_ROUTES } from "../bus.constants";
import type { JongroRoute } from "../bus.types";
import { REGISTRY_TTL_MS } from "./bus-registry.constants";
import { BusRegistryBootstrappingError, BusRegistryMissingError } from "./bus-registry.error";
import type { StationServiceHours } from "./bus-registry.document";
import { toRegistryRoute, toRegistryStations, toStationServiceHours } from "./bus-registry.mapper";
import { BusRegistryRepository } from "./bus-registry.repository";
import {
  toAgreedTurnaroundTopisId,
  toBootstrapDecision,
  toChangedShare,
  toObservedStations,
  toStationDiff,
  toStationsVersion,
  toSyncDecision,
  toTurnaroundTopisId,
} from "./bus-registry.rules";
import type { ArrivalRowHours, ArrivalRowStation, ObservedStation, PendingObservation, RegistryRoute } from "./bus-registry.types";

interface Observation {
  stations: ObservedStation[];
  turnaroundTopisId: string;
  stationsVersion: string;
}

@Injectable()
export class BusRegistryService {
  private readonly loaders = new Map<string, CachedLoader<RegistryRoute>>();
  private readonly pendingByRouteId = new Map<string, PendingObservation>();
  private readonly heldVersions = new Set<string>();
  private readonly hoursLoaders = new Map<string, CachedLoader<StationServiceHours[]>>();
  // WHY: the hours this poller last wrote per route, so an unchanged tick writes nothing.
  private readonly writtenHoursByRouteId = new Map<string, string>();
  // WHY: the loader caches no miss, so a route that stays missing is read, and would be logged, on every request; one
  // line per route each REGISTRY_TTL_MS, as often as a stored route is read again.
  private readonly missingThrottle = createLogThrottle(REGISTRY_TTL_MS);

  constructor(
    private readonly repository: BusRegistryRepository,
    private readonly clock: Clock,
  ) {}

  // WHY: the routes /bus/config lists; an unlisted route is read by id only, so its missing document never fails the config.
  listRoutes(): Promise<RegistryRoute[]> {
    return Promise.all(TOPIS_ROUTES.filter((route) => route.isListed).map((route) => this.routeOf(route.id)));
  }

  async routeOf(routeId: string): Promise<RegistryRoute> {
    try {
      return await this.loaderOf(routeId).get();
    } catch (err) {
      const ticket = err instanceof BusRegistryMissingError ? this.missingThrottle.take(routeId) : null;
      if (ticket) {
        logger.error(
          { event: "bus.jongro.registry_missing", routeId, suppressed: ticket.suppressed },
          "Jongro registry route missing — see docs/how-to/resync-the-jongro-registry.md",
        );
      }
      throw err;
    }
  }

  // WHY: the poller's read, where a missing route is the cue to bootstrap it, not a fault.
  async findRouteOf(routeId: string): Promise<RegistryRoute | null> {
    try {
      return await this.loaderOf(routeId).get();
    } catch (err) {
      if (err instanceof BusRegistryMissingError) return null;
      throw err;
    }
  }

  // WHY: a route with no document is inserted from TOPIS by the one poller, never over a stored one (ADR 0012, D3);
  // until one is stored the observation rejects, so the poller's tick reports the missing route.
  async bootstrap(route: JongroRoute, arrivals: readonly ArrivalRowStation[], sightingTurnaroundIds: ReadonlyArray<string | undefined>): Promise<void> {
    const stations = toObservedStations(arrivals);
    const turnaroundTopisId = toAgreedTurnaroundTopisId(sightingTurnaroundIds);
    const decision = toBootstrapDecision({ stations, turnaroundTopisId, pending: this.pendingByRouteId.get(route.id) });
    if (decision.kind === "insert") return this.insert(route, { stations, turnaroundTopisId: decision.turnaroundTopisId, stationsVersion: decision.stationsVersion });
    if (decision.kind === "pending") this.pendingByRouteId.set(route.id, decision.pending);
    throw new BusRegistryBootstrappingError(route.id, this.pendingByRouteId.get(route.id)?.count ?? 0);
  }

  // WHY: the poller's arrival list and position rows, compared each tick with the stored stations (ADR 0014, D4).
  async observe(route: RegistryRoute, arrivals: readonly ArrivalRowStation[], sightingTurnaroundIds: ReadonlyArray<string | undefined>): Promise<void> {
    const stations = toObservedStations(arrivals);
    if (stations.length === 0) return;
    const turnaroundTopisId = toTurnaroundTopisId(sightingTurnaroundIds, route.turnaroundTopisId);
    const observation = { stations, turnaroundTopisId, stationsVersion: toStationsVersion(stations, turnaroundTopisId) };
    const decision = toSyncDecision({
      storedVersion: route.stationsVersion,
      observedVersion: observation.stationsVersion,
      pending: this.pendingByRouteId.get(route.id),
      changedShare: toChangedShare(route.registryStations, stations),
    });
    if (decision.kind === "unchanged") this.pendingByRouteId.delete(route.id);
    else if (decision.kind === "pending") this.pendingByRouteId.set(route.id, decision.pending);
    else if (decision.kind === "hold") this.hold(route, observation, decision.pending);
    else await this.apply(route, observation);
  }

  // WHY: TOPIS answers no rows overnight, so an empty tick keeps the stored hours, which name the next first run then;
  // a change is written once, since TOPIS dates the hours by its service day.
  async observeServiceHours(route: RegistryRoute, arrivals: readonly ArrivalRowHours[]): Promise<void> {
    const hours = toStationServiceHours(arrivals);
    const key = JSON.stringify(hours);
    if (hours.length === 0 || this.writtenHoursByRouteId.get(route.id) === key) return;
    await this.repository.updateServiceHours(route.id, hours);
    this.writtenHoursByRouteId.set(route.id, key);
    this.hoursLoaderOf(route.id).clear();
  }

  listServiceHours(routeId: string): Promise<StationServiceHours[]> {
    return this.hoursLoaderOf(routeId).get();
  }

  private hoursLoaderOf(routeId: string): CachedLoader<StationServiceHours[]> {
    const existing = this.hoursLoaders.get(routeId);
    if (existing) return existing;
    const loader = createCachedLoader({ name: `jongro_routes.${routeId}.service_hours`, ttlMs: REGISTRY_TTL_MS, load: () => this.repository.listServiceHours(routeId) });
    this.hoursLoaders.set(routeId, loader);
    return loader;
  }

  private async insert(route: JongroRoute, observation: Observation): Promise<void> {
    this.pendingByRouteId.delete(route.id);
    const isInserted = await this.repository.insertRoute({ _id: route.id, ...observation, stations: toRegistryStations(observation.stations), syncedAt: this.clock.now() });
    this.loaderOf(route.id).clear();
    const fields = { code: route.code, stationsVersion: observation.stationsVersion };
    if (!isInserted) {
      logger.warn({ event: "bus.jongro.registry_bootstrap_conflict", ...fields }, "A Jongro registry route was stored before the bootstrap wrote; kept it");
      return;
    }
    logger.warn(
      { event: "bus.jongro.registry_bootstrapped", ...fields, turnaroundTopisId: observation.turnaroundTopisId, stationCount: observation.stations.length },
      "Bootstrapped a missing Jongro registry route from TOPIS — see docs/how-to/resync-the-jongro-registry.md",
    );
  }

  private hold(route: RegistryRoute, observation: Observation, pending: PendingObservation): void {
    this.pendingByRouteId.set(route.id, pending);
    const heldKey = `${route.id}:${observation.stationsVersion}`;
    if (this.heldVersions.has(heldKey)) return;
    this.heldVersions.add(heldKey);
    logger.error(
      { event: "bus.jongro.registry_change_held", code: route.code, fromVersion: route.stationsVersion, toVersion: observation.stationsVersion, observed: observation.stations, ...toStationDiff(route.registryStations, observation.stations) },
      "Held a Jongro stop list change over 30% of the stops — see docs/how-to/resync-the-jongro-registry.md",
    );
  }

  private async apply(route: RegistryRoute, observation: Observation): Promise<void> {
    this.pendingByRouteId.delete(route.id);
    const isWritten = await this.repository.updateStations(route.id, route.stationsVersion, {
      stations: toRegistryStations(observation.stations),
      turnaroundTopisId: observation.turnaroundTopisId,
      stationsVersion: observation.stationsVersion,
      syncedAt: this.clock.now(),
    });
    this.loaderOf(route.id).clear();
    const versions = { code: route.code, fromVersion: route.stationsVersion, toVersion: observation.stationsVersion };
    if (!isWritten) {
      logger.warn({ event: "bus.jongro.registry_sync_conflict", ...versions }, "The Jongro registry changed before the sync wrote; nothing written");
      return;
    }
    logger.warn(
      { event: "bus.jongro.registry_synced", ...versions, fromTurnaroundTopisId: route.turnaroundTopisId, toTurnaroundTopisId: observation.turnaroundTopisId, ...toStationDiff(route.registryStations, observation.stations) },
      "Synced a Jongro route's stations from TOPIS",
    );
  }

  private loaderOf(routeId: string): CachedLoader<RegistryRoute> {
    const existing = this.loaders.get(routeId);
    if (existing) return existing;
    const loader = createCachedLoader({ name: `jongro_routes.${routeId}`, ttlMs: REGISTRY_TTL_MS, load: () => this.loadRoute(routeId) });
    this.loaders.set(routeId, loader);
    return loader;
  }

  private async loadRoute(routeId: string): Promise<RegistryRoute> {
    const identity = TOPIS_ROUTES.find((entry) => entry.id === routeId);
    if (identity === undefined) throw new Error(`Unknown Jongro route ${routeId}`);
    const doc = await this.repository.findRoute(routeId);
    if (doc === null) throw new BusRegistryMissingError(routeId);
    return toRegistryRoute(identity, doc);
  }
}
