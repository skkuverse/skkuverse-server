import { Injectable, type OnModuleInit } from "@nestjs/common";
import { createCachedLoader } from "../../infra/cached-loader";
import { Clock } from "../../infra/clock";
import logger from "../../infra/logger";
import { jongroRoutes } from "../bus.config";
import type { JongroRoute } from "../bus.types";
import { BusRoutePathClient } from "./bus-route-path.client";
import { routePathsSeed } from "./bus-route-path.config";
import { ROUTE_PATHS_STALE_WINDOW_MS, ROUTE_PATHS_TTL_MS } from "./bus-route-path.constants";
import type { JongroRoutePathDocument } from "./bus-route-path.document";
import { toRoutePath, toRoutePathDocument, toSeedRoutePath } from "./bus-route-path.mapper";
import { BusRoutePathRepository } from "./bus-route-path.repository";
import { toPathShape, toPathSyncDecision } from "./bus-route-path.rules";
import type { FetchedRoutePath, PathHoldReason, RoutePaths } from "./bus-route-path.types";

interface HeldChange {
  baseline: JongroRoutePathDocument;
  next: JongroRoutePathDocument;
  reason: PathHoldReason;
}

@Injectable()
export class BusRoutePathService implements OnModuleInit {
  private readonly heldVersions = new Set<string>();
  private readonly loader = createCachedLoader({
    name: "jongro_route_paths",
    ttlMs: ROUTE_PATHS_TTL_MS,
    staleWindowMs: ROUTE_PATHS_STALE_WINDOW_MS,
    load: () => this.repository.listRoutePaths(),
  });

  constructor(
    private readonly repository: BusRoutePathRepository,
    private readonly client: BusRoutePathClient,
    private readonly clock: Clock,
  ) {}

  // WHY: every role seeds, as the registry does, since a host may run api replicas without a poller.
  async onModuleInit(): Promise<void> {
    for (const route of jongroRoutes) await this.seedRoute(route);
  }

  // WHY: a line months old still draws the route, so a missing or unreadable one comes from the snapshot rather
  // than failing the map (add-jongro-route-lines D5).
  async listRoutePaths(): Promise<RoutePaths> {
    const docs = await this.readStored();
    const byId = new Map((docs ?? []).map((doc) => [doc._id, doc]));
    const missingIds = jongroRoutes.filter((route) => !byId.has(route.id)).map((route) => route.id);
    if (docs !== null && missingIds.length > 0) {
      logger.warn({ event: "bus.jongro.path_missing", routeIds: missingIds }, "Jongro route lines missing; drawing them from the snapshot");
    }
    return {
      routePaths: jongroRoutes.map((route) => toRoutePath(route, byId.get(route.id) ?? this.seedOf(route.id))),
      isSeedFallback: missingIds.length > 0,
    };
  }

  async sync(route: JongroRoute): Promise<void> {
    const [fetched, docs] = await Promise.all([this.client.fetchRoutePath(route.busRouteId), this.repository.listRoutePaths()]);
    const stored = docs.find((doc) => doc._id === route.id) ?? null;
    const baseline = stored ?? toRoutePathDocument(route, this.seedOf(route.id), this.clock.now());
    const next = toRoutePathDocument(route, fetched, this.clock.now());
    const decision = toPathSyncDecision(
      { pathVersion: baseline.pathVersion, shape: toPathShape(baseline.path) },
      { pathVersion: next.pathVersion, shape: toPathShape(next.path), stationCount: next.stations.length },
    );
    if (decision.kind === "unchanged" && stored !== null) return;
    if (decision.kind === "hold") return this.hold(route, { baseline, next, reason: decision.reason });
    await this.apply(route, stored, next);
  }

  private async readStored(): Promise<JongroRoutePathDocument[] | null> {
    try {
      return await this.loader.get();
    } catch (err) {
      logger.warn({ event: "bus.jongro.path_read_failed", err }, "Jongro route lines unreadable; drawing them from the snapshot");
      return null;
    }
  }

  private seedOf(routeId: string): FetchedRoutePath {
    const entry = routePathsSeed.find((seed) => seed.id === routeId);
    if (entry === undefined) throw new Error(`jongro-route-paths.seed.json has no ${routeId}`);
    return toSeedRoutePath(entry);
  }

  private async seedRoute(route: JongroRoute): Promise<void> {
    const doc = toRoutePathDocument(route, this.seedOf(route.id), this.clock.now());
    try {
      if (await this.repository.insertRoutePath(doc)) {
        logger.warn({ event: "bus.jongro.path_seeded", routeId: route.id, pathVersion: doc.pathVersion }, "Seeded a Jongro route line from the snapshot");
      }
    } catch (err) {
      // WHY: a stored line still serves and a missing one draws from the snapshot, so a boot never crash-loops on Atlas.
      logger.error({ event: "bus.jongro.path_seed_failed", routeId: route.id, err }, "Could not seed a Jongro route line");
    }
  }

  private hold(route: JongroRoute, { baseline, next, reason }: HeldChange): void {
    const heldKey = `${route.id}:${next.pathVersion}`;
    if (this.heldVersions.has(heldKey)) return;
    this.heldVersions.add(heldKey);
    const from = toPathShape(baseline.path);
    const to = toPathShape(next.path);
    logger.warn(
      {
        event: "bus.jongro.path_change_held",
        routeId: route.id,
        reason,
        fromVersion: baseline.pathVersion,
        toVersion: next.pathVersion,
        fromPointCount: from.pointCount,
        toPointCount: to.pointCount,
        fromLengthMeters: Math.round(from.lengthMeters),
        toLengthMeters: Math.round(to.lengthMeters),
        fromStationCount: baseline.stations.length,
        toStationCount: next.stations.length,
      },
      "Held a Jongro route line change from TOPIS; nothing written",
    );
  }

  private async apply(route: JongroRoute, stored: JongroRoutePathDocument | null, next: JongroRoutePathDocument): Promise<void> {
    const isWritten = stored === null ? await this.repository.insertRoutePath(next) : await this.repository.updateRoutePath(stored.pathVersion, next);
    this.loader.clear();
    const versions = { routeId: route.id, fromVersion: stored?.pathVersion ?? null, toVersion: next.pathVersion };
    if (!isWritten) {
      logger.warn({ event: "bus.jongro.path_sync_conflict", ...versions }, "The Jongro route line changed before the sync wrote; nothing written");
      return;
    }
    logger.warn(
      { event: "bus.jongro.path_synced", ...versions, pointCount: next.path.length, stationCount: next.stations.length },
      "Synced a Jongro route line from TOPIS",
    );
  }
}
