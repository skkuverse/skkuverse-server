import { Injectable, type OnModuleInit } from "@nestjs/common";
import { createCachedLoader, type CachedLoader } from "../../infra/cached-loader";
import { Clock } from "../../infra/clock";
import logger from "../../infra/logger";
import { jongroRoutes } from "../bus.config";
import type { JongroRoute } from "../bus.types";
import { stationsSeed } from "./bus-registry.config";
import { REGISTRY_TTL_MS } from "./bus-registry.constants";
import type { JongroRouteDocument } from "./bus-registry.document";
import { BusRegistryMissingError } from "./bus-registry.error";
import { toRegistryRoute, toRegistryStations } from "./bus-registry.mapper";
import { BusRegistryRepository } from "./bus-registry.repository";
import { toChangedShare, toObservedStations, toStationDiff, toStationsVersion, toSyncDecision, toTurnaroundTopisId } from "./bus-registry.rules";
import type { ArrivalRowStation, ObservedStation, PendingObservation, RegistryRoute } from "./bus-registry.types";

interface Observation {
  stations: ObservedStation[];
  turnaroundTopisId: string;
  stationsVersion: string;
}

@Injectable()
export class BusRegistryService implements OnModuleInit {
  private readonly loaders = new Map<string, CachedLoader<RegistryRoute>>();
  private readonly pendingByRouteId = new Map<string, PendingObservation>();
  private readonly heldVersions = new Set<string>();
  private readonly warnedTransferKeys = new Set<string>();

  constructor(
    private readonly repository: BusRegistryRepository,
    private readonly clock: Clock,
  ) {}

  // WHY: every role seeds, since a standby host runs api replicas without a poller (improve-jongro-realtime D7).
  async onModuleInit(): Promise<void> {
    for (const route of jongroRoutes) await this.seedRoute(route);
  }

  listRoutes(): Promise<RegistryRoute[]> {
    return Promise.all(jongroRoutes.map((route) => this.routeOf(route.id)));
  }

  routeOf(routeId: string): Promise<RegistryRoute> {
    return this.loaderOf(routeId).get();
  }

  // WHY: the poller's arrival list and position rows, compared each tick with the stored stations (design D9).
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

  private async seedRoute(route: JongroRoute): Promise<void> {
    const seed = stationsSeed.find((entry) => entry.id === route.id);
    if (seed === undefined) throw new Error(`jongro-stations.seed.json has no ${route.id}`);
    const doc: JongroRouteDocument = {
      _id: route.id,
      stations: toRegistryStations(seed.stations),
      turnaroundTopisId: seed.turnaroundTopisId,
      stationsVersion: toStationsVersion(seed.stations, seed.turnaroundTopisId),
      syncedAt: this.clock.now(),
    };
    try {
      if (await this.repository.insertRoute(doc)) {
        logger.warn({ event: "bus.jongro.registry_seeded", routeId: route.id, stationsVersion: doc.stationsVersion }, "Seeded a Jongro registry route from the snapshot");
      }
    } catch (err) {
      // WHY: a stored route still serves, and a missing one answers 503 at read, so a boot never crash-loops on Atlas.
      logger.error({ event: "bus.jongro.registry_seed_failed", routeId: route.id, err }, "Could not seed a Jongro registry route");
    }
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
    const route = jongroRoutes.find((entry) => entry.id === routeId);
    if (route === undefined) throw new Error(`Unknown Jongro route ${routeId}`);
    const doc = await this.repository.findRoute(routeId);
    if (doc === null) {
      logger.error({ event: "bus.jongro.registry_missing", routeId }, "Jongro registry route missing — see docs/how-to/resync-the-jongro-registry.md");
      throw new BusRegistryMissingError(routeId);
    }
    this.warnUnmatchedTransferLines(route, doc);
    return toRegistryRoute(route, doc);
  }

  // WHY: stations change at runtime now, so an override nothing matches is a warning, not a boot failure.
  private warnUnmatchedTransferLines(route: JongroRoute, doc: JongroRouteDocument): void {
    const arsIds = new Set(doc.stations.map((station) => station.arsId));
    const unmatched = Object.keys(route.transferLinesByArsId).filter((arsId) => !arsIds.has(arsId) && !this.warnedTransferKeys.has(`${route.id}:${arsId}`));
    if (unmatched.length === 0) return;
    for (const arsId of unmatched) this.warnedTransferKeys.add(`${route.id}:${arsId}`);
    logger.warn({ event: "bus.jongro.registry_unmatched_transfer", routeId: route.id, arsIds: unmatched }, "A transfer override names an ARS number no stored station has");
  }
}
