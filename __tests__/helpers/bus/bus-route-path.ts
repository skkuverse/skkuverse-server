/**
 * The Jongro route lines as production stored them on 2026-10-18
 * (fixtures/jongro-route-paths.json): each route's line as TOPIS answered it,
 * its stored documents, an in-memory repository holding them, and a
 * BusRoutePathService over that repository, which a spec of a reader of the
 * lines (the bus config) builds on. Each station carries the direction TOPIS
 * named on 2026-10-23 (the fixture's `_about`). No process
 * seeds the lines at boot (ADR 0012, D3), so a test that needs
 * a stored line stores it here.
 */
import { JONGRO_ROUTES } from "../../../src/bus/bus.constants";
import { toJongroRoute } from "../../../src/bus/bus.mapper";
import type { BusRoutePathClient } from "../../../src/bus/route-path/bus-route-path.client";
import type { JongroRoutePathDocument } from "../../../src/bus/route-path/bus-route-path.document";
import type { BusRoutePathRepository } from "../../../src/bus/route-path/bus-route-path.repository";
import { BusRoutePathService } from "../../../src/bus/route-path/bus-route-path.service";
import { toRoutePathDocument } from "../../../src/bus/route-path/bus-route-path.mapper";
import type { FetchedRoutePath } from "../../../src/bus/route-path/bus-route-path.types";
import capturedLines from "../../nest/bus/fixtures/jongro-route-paths.json";
import { FakeBusRoutePathClient } from "../fakes/bus/bus-route-path.client.fake";
import { FakeBusRoutePathRepository } from "../fakes/bus/bus-route-path.repository.fake";
import { asReal } from "../fakes/public-of";

const jongroRoutes = JONGRO_ROUTES.map(toJongroRoute);

const STORED_AT = new Date("2026-10-18T03:00:00Z");

export function capturedRoutePathOf(routeId: string): FetchedRoutePath {
  const entry = capturedLines.routes.find((route) => route.id === routeId);
  if (entry === undefined) throw new Error(`jongro-route-paths.json has no ${routeId}`);
  return {
    path: entry.path.map(([lng, lat]) => [lng!, lat!]),
    stations: entry.stations.map((station, index) => ({ ...station, sequence: index + 1 })),
  };
}

export function storedJongroRoutePathDocuments(syncedAt = STORED_AT): JongroRoutePathDocument[] {
  return jongroRoutes.map((route) => toRoutePathDocument(route, capturedRoutePathOf(route.id), syncedAt));
}

export function storedBusRoutePathRepository(syncedAt = STORED_AT): FakeBusRoutePathRepository {
  const repository = new FakeBusRoutePathRepository();
  for (const doc of storedJongroRoutePathDocuments(syncedAt)) repository.routePaths.set(doc._id, doc);
  return repository;
}

export function storedBusRoutePathService(repository = storedBusRoutePathRepository()): BusRoutePathService {
  return new BusRoutePathService(asReal<BusRoutePathRepository>(repository), asReal<BusRoutePathClient>(new FakeBusRoutePathClient()), { now: () => STORED_AT });
}
