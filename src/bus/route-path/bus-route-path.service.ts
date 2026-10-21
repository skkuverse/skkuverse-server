import { Injectable } from "@nestjs/common";
import { createCachedLoader } from "../../infra/cached-loader";
import { Clock } from "../../infra/clock";
import { createLogThrottle } from "../../infra/log-throttle";
import logger from "../../infra/logger";
import { JONGRO_ROUTES } from "../bus.constants";
import { toJongroRoute } from "../bus.mapper";
import type { JongroRoute } from "../bus.types";
import { BusRoutePathClient } from "./bus-route-path.client";
import { ROUTE_PATHS_LOG_INTERVAL_MS, ROUTE_PATHS_RETRY_MS, ROUTE_PATHS_STALE_WINDOW_MS, ROUTE_PATHS_TTL_MS } from "./bus-route-path.constants";
import type { JongroRoutePathDocument } from "./bus-route-path.document";
import { BusRoutePathUnavailableError } from "./bus-route-path.error";
import { toRoutePath, toRoutePathDocument } from "./bus-route-path.mapper";
import { BusRoutePathRepository } from "./bus-route-path.repository";
import { toPathShape, toPathSyncDecision } from "./bus-route-path.rules";
import type { PathHoldReason, RoutePaths } from "./bus-route-path.types";

interface HeldChange {
  stored: JongroRoutePathDocument | null;
  next: JongroRoutePathDocument;
  reason: PathHoldReason;
}

@Injectable()
export class BusRoutePathService {
  private readonly heldVersions = new Set<string>();
  private readonly logThrottle = createLogThrottle(ROUTE_PATHS_LOG_INTERVAL_MS, () => this.clock.now().getTime());
  // WHY: the loader caches no failure, so a cold outage would otherwise cost one read per stop page.
  private failedReadHeldUntilMs = 0;
  private readonly loader = createCachedLoader({
    name: "jongro_route_paths",
    ttlMs: ROUTE_PATHS_TTL_MS,
    staleWindowMs: ROUTE_PATHS_STALE_WINDOW_MS,
    serveStale: "on-reload-failure",
    load: () => this.repository.listRoutePaths(),
  });

  constructor(
    private readonly repository: BusRoutePathRepository,
    private readonly client: BusRoutePathClient,
    private readonly clock: Clock,
  ) {}

  // WHY: a missing line is left out rather than drawn from a committed copy, and the daily sync writes it (ADR 0012, D3).
  async listRoutePaths(): Promise<RoutePaths> {
    const byId = new Map((await this.readStored()).map((doc) => [doc._id, doc]));
    const jongroRoutes = JONGRO_ROUTES.map(toJongroRoute);
    const missingIds = jongroRoutes.filter((route) => !byId.has(route.id)).map((route) => route.id);
    const ticket = missingIds.length > 0 ? this.logThrottle.take(`missing:${missingIds.join(",")}`) : null;
    if (ticket) {
      logger.error({ event: "bus.jongro.path_missing", routeIds: missingIds, suppressed: ticket.suppressed }, "Jongro route lines missing; left out of the overlays");
    }
    return {
      routePaths: jongroRoutes.flatMap((route) => {
        const doc = byId.get(route.id);
        return doc === undefined ? [] : [toRoutePath(route, doc)];
      }),
      hasMissingRoutes: missingIds.length > 0,
    };
  }

  async sync(route: JongroRoute): Promise<void> {
    const [fetched, docs] = await Promise.all([this.client.fetchRoutePath(route.busRouteId), this.repository.listRoutePaths()]);
    const stored = docs.find((doc) => doc._id === route.id) ?? null;
    const next = toRoutePathDocument(route, fetched, this.clock.now());
    const decision = toPathSyncDecision(
      stored && { pathVersion: stored.pathVersion, shape: toPathShape(stored.path) },
      { pathVersion: next.pathVersion, shape: toPathShape(next.path), stationCount: next.stations.length },
    );
    if (decision.kind === "unchanged") return;
    if (decision.kind === "hold") return this.hold(route, { stored, next, reason: decision.reason });
    await this.apply(route, stored, next);
  }

  private async readStored(): Promise<JongroRoutePathDocument[]> {
    if (this.clock.now().getTime() < this.failedReadHeldUntilMs) throw new BusRoutePathUnavailableError();
    try {
      return await this.loader.get();
    } catch (err) {
      this.failedReadHeldUntilMs = this.clock.now().getTime() + ROUTE_PATHS_RETRY_MS;
      const ticket = this.logThrottle.take("read_failed");
      if (ticket) logger.error({ event: "bus.jongro.path_read_failed", suppressed: ticket.suppressed, err }, "Jongro route lines unreadable with none cached");
      throw new BusRoutePathUnavailableError();
    }
  }

  private hold(route: JongroRoute, { stored, next, reason }: HeldChange): void {
    const heldKey = `${route.id}:${next.pathVersion}`;
    if (this.heldVersions.has(heldKey)) return;
    this.heldVersions.add(heldKey);
    const to = toPathShape(next.path);
    logger.warn(
      {
        event: "bus.jongro.path_change_held",
        routeId: route.id,
        reason,
        ...this.storedFieldsOf(stored),
        toVersion: next.pathVersion,
        toPointCount: to.pointCount,
        toLengthMeters: Math.round(to.lengthMeters),
        toStationCount: next.stations.length,
      },
      "Held a Jongro route line change from TOPIS; nothing written",
    );
  }

  private storedFieldsOf(stored: JongroRoutePathDocument | null): Record<`from${"Version" | "PointCount" | "LengthMeters" | "StationCount"}`, string | number | null> {
    if (stored === null) return { fromVersion: null, fromPointCount: null, fromLengthMeters: null, fromStationCount: null };
    const from = toPathShape(stored.path);
    return { fromVersion: stored.pathVersion, fromPointCount: from.pointCount, fromLengthMeters: Math.round(from.lengthMeters), fromStationCount: stored.stations.length };
  }

  private async apply(route: JongroRoute, stored: JongroRoutePathDocument | null, next: JongroRoutePathDocument): Promise<void> {
    const isWritten = stored === null ? await this.repository.insertRoutePath(next) : await this.repository.updateRoutePath(stored.pathVersion, next);
    this.loader.clear();
    this.failedReadHeldUntilMs = 0;
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
