import { Injectable } from "@nestjs/common";
import { AppError } from "../../http/app.error";
import { Clock } from "../../infra/clock";
import { createLogThrottle } from "../../infra/log-throttle";
import logger from "../../infra/logger";
import type { SupportedLang } from "../../infra/types";
import type { LatLng } from "../../shared/lat-lng.types";
import type { ServedStop } from "../bus.wire";
import { JONGRO_ROUTES } from "../bus.constants";
import { BusRegistryService } from "../registry/bus-registry.service";
import type { RegistryRoute } from "../registry/bus-registry.types";
import { BusRoutePathService } from "../route-path/bus-route-path.service";
import { BusStopsService } from "../stops/bus-stops.service";
import { REGISTRY_RETRY_MS, STOP_INDEX_LOG_INTERVAL_MS } from "./bus-stop-index.constants";
import { toPoleCoords } from "./bus-stop-index.mapper";
import { toPoleArsId, toStopIndex } from "./bus-stop-index.rules";
import type { FoundStop, IndexedStop, StopIndex } from "./bus-stop-index.types";

interface BuiltIndex {
  key: string;
  index: StopIndex;
  /** WHY: when a build that left out an unreadable route may read the registry again; null when every route was read. */
  retryAtMs: number | null;
}

// SEE: docs/explanation/bus-architecture.md ("Glossary"): the stop index, derived at read and never stored.
@Injectable()
export class BusStopIndexService {
  // WHY: keyed by the stops' revision and every route's stations version, so a push or a TOPIS sync rebuilds it
  // within its source's TTL (ADR 0013 D6, "a derived cache keeps the bound").
  private built: BuiltIndex | null = null;
  private readonly warnedRevisions = new Set<number>();
  private readonly logThrottle = createLogThrottle(STOP_INDEX_LOG_INTERVAL_MS, () => this.clock.now().getTime());

  constructor(
    private readonly stops: BusStopsService,
    private readonly registry: BusRegistryService,
    private readonly routePaths: BusRoutePathService,
    private readonly clock: Clock,
  ) {}

  async findStop(stopId: string): Promise<FoundStop | null> {
    const index = await this.current();
    const arsId = toPoleArsId(stopId);
    const canonicalId = arsId === null ? stopId : (index.stopIdByArsId.get(arsId) ?? this.aliasOwnerWhileUnread(index, arsId));
    const stop = canonicalId === undefined ? undefined : index.stopById.get(canonicalId);
    if (stop) return { ...stop, snapshot: index.snapshot, coords: stop.localStop?.coords ?? (await this.poleCoordsOf(stop)) };
    if (arsId !== null && index.registryFailure !== undefined) throw this.toRegistryUnavailable(index.registryFailure);
    return null;
  }

  // WHY: a local stop is served as its config record, so a stop page and /bus/config cannot drift; a pole has none.
  servedRecordOf(stop: FoundStop, lang: SupportedLang): ServedStop | null {
    return stop.localStop && this.stops.servedStop(stop.localStop, lang);
  }

  private async current(): Promise<StopIndex> {
    const snapshot = await this.stops.current();
    const nowMs = this.clock.now().getTime();
    const held = this.built;
    if (held?.retryAtMs != null && nowMs < held.retryAtMs && held.index.snapshot.revision === snapshot.revision) return held.index;
    const reads = await Promise.allSettled(JONGRO_ROUTES.map((route) => this.registry.routeOf(route.id)));
    const key = [snapshot.revision, ...reads.map((read) => (read.status === "fulfilled" ? read.value.stationsVersion : "unread"))].join(":");
    const failed = reads.find((read): read is PromiseRejectedResult => read.status === "rejected");
    const index = held?.key === key ? held.index : this.buildIndex(snapshot, reads, failed);
    this.built = { key, index, retryAtMs: failed ? nowMs + REGISTRY_RETRY_MS : null };
    return index;
  }

  private buildIndex(snapshot: StopIndex["snapshot"], reads: PromiseSettledResult<RegistryRoute>[], failed: PromiseRejectedResult | undefined): StopIndex {
    const routes = reads.flatMap((read): RegistryRoute[] => (read.status === "fulfilled" ? [read.value] : []));
    const index: StopIndex = { ...toStopIndex(snapshot, routes), ...(failed && { registryFailure: failed.reason }) };
    if (failed) this.logUnreadRoutes(reads);
    else this.warnUnmatchedAliases(index);
    return index;
  }

  // WHY: an aliased pole is the dataset's, so its local stop still serves while the registry that lists it cannot be read.
  private aliasOwnerWhileUnread(index: StopIndex, arsId: string): string | undefined {
    return index.registryFailure === undefined ? undefined : index.snapshot.stopIdByArsId.get(arsId);
  }

  private toRegistryUnavailable(failure: unknown): AppError {
    if (failure instanceof AppError) return failure;
    return new AppError("JONGRO_REGISTRY_UNAVAILABLE", "The Jongro station registry is unavailable", 503);
  }

  // WHY: a map pin is optional on a stop page, so a route line that cannot be read leaves it out.
  private async poleCoordsOf(stop: IndexedStop): Promise<LatLng | null> {
    if (stop.poles.length === 0) return null;
    try {
      return toPoleCoords(stop.poles, (await this.routePaths.listRoutePaths()).routePaths);
    } catch (err) {
      const ticket = this.logThrottle.take("coords");
      if (ticket) logger.warn({ event: "bus.stop_index.coords_unavailable", stopId: stop.id, suppressed: ticket.suppressed, err }, "Route lines unreadable; stop served without coordinates");
      return null;
    }
  }

  private logUnreadRoutes(reads: PromiseSettledResult<RegistryRoute>[]): void {
    const routeIds = JONGRO_ROUTES.filter((_route, index) => reads[index]?.status === "rejected").map((route) => route.id);
    const err: unknown = reads.find((read): read is PromiseRejectedResult => read.status === "rejected")?.reason;
    const ticket = this.logThrottle.take(`unread:${routeIds.join(",")}`);
    if (ticket) {
      logger.error(
        { event: "bus.stop_index.registry_unread", routeIds, suppressed: ticket.suppressed, err },
        "Jongro registry routes unreadable; their stops are left out of the stop index",
      );
    }
  }

  // WHY: stations change at runtime, so an alias no stored station has is a warning once per revision, not a refusal.
  private warnUnmatchedAliases({ snapshot: { revision }, unmatchedArsIds }: StopIndex): void {
    if (unmatchedArsIds.length === 0 || this.warnedRevisions.has(revision)) return;
    this.warnedRevisions.add(revision);
    logger.warn({ event: "bus.stop_index.alias_unmatched", revision, arsIds: unmatchedArsIds }, "A stop aliases an ARS number no stored station has");
  }
}
