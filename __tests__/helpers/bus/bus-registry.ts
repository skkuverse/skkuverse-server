/**
 * The Jongro registry as production stored it on 2026-10-17
 * (fixtures/jongro-registry-routes.json): its documents, an in-memory
 * repository holding them, and a BusRegistryService over that repository,
 * which a spec of a reader of the registry (the realtime group, the bus
 * config, the ui) builds on. No process seeds the registry at boot
 * (ADR 0012, D3), so a test that needs a route stores it here.
 */
import { BusRegistryService } from "../../../src/bus/registry/bus-registry.service";
import type { JongroRouteDocument } from "../../../src/bus/registry/bus-registry.document";
import { toRegistryStations } from "../../../src/bus/registry/bus-registry.mapper";
import type { BusRegistryRepository } from "../../../src/bus/registry/bus-registry.repository";
import { toStationsVersion } from "../../../src/bus/registry/bus-registry.rules";
import type { ObservedStation } from "../../../src/bus/registry/bus-registry.types";
import storedRoutes from "../../nest/bus/fixtures/jongro-registry-routes.json";
import { FakeBusRegistryRepository } from "../fakes/bus/bus-registry.repository.fake";
import { asReal } from "../fakes/public-of";

const STORED_AT = new Date("2026-10-17T12:00:00Z");

/** The stations of a stored route in TOPIS order, as the poller observes them. */
export function capturedStationsOf(routeId: string): ObservedStation[] {
  const route = storedRoutes.routes.find((entry) => entry.id === routeId);
  if (route === undefined) throw new Error(`jongro-registry-routes.json has no ${routeId}`);
  return route.stations.map((station) => ({ ...station }));
}

export function storedJongroRouteDocuments(syncedAt = STORED_AT): JongroRouteDocument[] {
  return storedRoutes.routes.map((route) => ({
    _id: route.id,
    stations: toRegistryStations(route.stations),
    turnaroundTopisId: route.turnaroundTopisId,
    stationsVersion: toStationsVersion(route.stations, route.turnaroundTopisId),
    syncedAt,
  }));
}

export function storedBusRegistryRepository(): FakeBusRegistryRepository {
  const repository = new FakeBusRegistryRepository();
  for (const doc of storedJongroRouteDocuments()) repository.routes.set(doc._id, doc);
  return repository;
}

export function storedBusRegistryService(repository = storedBusRegistryRepository()): BusRegistryService {
  return new BusRegistryService(asReal<BusRegistryRepository>(repository), { now: () => STORED_AT });
}
