import { Injectable } from "@nestjs/common";
import { AppError } from "../../http/app.error";
import { Clock } from "../../infra/clock";
import { createLogThrottle } from "../../infra/log-throttle";
import logger from "../../infra/logger";
import type { SupportedLang } from "../../infra/types";
import type { LatLng } from "../../shared/lat-lng.types";
import type { JongroRoute } from "../bus.types";
import type { ServedStop } from "../bus.wire";
import { SLUG_LETTER_PATTERN, TOPIS_ROUTES } from "../bus.constants";
import { BusRegistryService } from "../registry/bus-registry.service";
import type { RegistryRoute } from "../registry/bus-registry.types";
import { BusRoutePathService } from "../route-path/bus-route-path.service";
import type { RoutePaths } from "../route-path/bus-route-path.types";
import { BusStopsService } from "../stops/bus-stops.service";
import { REGISTRY_RETRY_MS, STOP_INDEX_LOG_INTERVAL_MS } from "./bus-stop-index.constants";
import { toPoleCoords } from "./bus-stop-index.mapper";
import { hasPoleAliases, toCanonicalStopId, toPoleArsId, toStopIndex } from "./bus-stop-index.rules";
import type { FoundStop, IndexedStop, StopIndex, StopList } from "./bus-stop-index.types";

interface BuiltIndex {
  key: string;
  index: StopIndex;
  /** WHY: when a build that left out an unreadable or unstored route may read the registry again; null when every route was read. */
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
    const canonicalId = toCanonicalStopId(index, stopId) ?? this.aliasOwnerWhileUnread(index, stopId);
    const stop = canonicalId === undefined ? undefined : index.stopById.get(canonicalId);
    if (stop) return { ...stop, snapshot: index.snapshot, coords: stop.localStop?.coords ?? (await this.poleCoordsOf(stop)) };
    if (index.registryFailure !== undefined && this.isPoleOrAliasing(index, stopId)) throw this.toRegistryUnavailable(index.registryFailure);
    return null;
  }

  // WHY: the route lines are read once for every pole, so a list costs what one stop page does.
  async listStops(): Promise<StopList> {
    const index = await this.current();
    const routePaths = await this.readRoutePathsOrNone();
    const stops = [...index.stopById.values()].map((stop) => ({ ...stop, coords: stop.localStop?.coords ?? (routePaths && toPoleCoords(stop.poles, routePaths.routePaths)) }));
    return { snapshot: index.snapshot, stops, isPartial: index.registryFailure !== undefined || routePaths === null || routePaths.hasMissingRoutes };
  }

  // WHY: a local stop is served as its config record, so a stop page and /bus/config cannot drift; a pole has none.
  servedRecordOf(stop: FoundStop, lang: SupportedLang): ServedStop | null {
    return stop.localStop && this.stops.servedStop(stop.localStop, lang);
  }

  private async current(): Promise<StopIndex> {
    const snapshot = await this.stops.current();
    const nowMs = this.clock.now().getTime();
    const held = this.built;
    const heldIndex = this.heldIndexOf(held, nowMs, snapshot.revision);
    if (heldIndex) return heldIndex;
    const reads = await Promise.allSettled(TOPIS_ROUTES.map((route) => this.readRoute(route)));
    const key = [snapshot.revision, ...reads.map((read) => (read.status === "fulfilled" ? (read.value?.stationsVersion ?? "none") : "unread"))].join(":");
    const failed = reads.find((read): read is PromiseRejectedResult => read.status === "rejected");
    const index = held?.key === key ? held.index : this.buildIndex(snapshot, reads, failed);
    if (failed) this.logUnreadRoutes(reads);
    this.built = { key, index, retryAtMs: this.isRetried(reads) ? nowMs + REGISTRY_RETRY_MS : null };
    return index;
  }

  private heldIndexOf(held: BuiltIndex | null, nowMs: number, revision: number): StopIndex | null {
    return held?.retryAtMs != null && nowMs < held.retryAtMs && held.index.snapshot.revision === revision ? held.index : null;
  }

  // WHY: a miss is not cached by the registry's loader, so an unlisted route not stored yet is read again only after
  // the retry, as an unreadable one is, not once per request.
  private isRetried(reads: PromiseSettledResult<RegistryRoute | null>[]): boolean {
    return reads.some((read) => read.status === "rejected" || read.value === null);
  }

  // WHY: an unlisted route adds only aliased poles (ADR 0019, D5), so one not stored yet (REGIONAL_BUS=off stores none)
  // fails nothing; a failed read of the shared collection is the listed routes' to report.
  private readRoute(route: JongroRoute): Promise<RegistryRoute | null> {
    return route.isListed ? this.registry.routeOf(route.id) : this.registry.findRouteOf(route.id).catch(() => null);
  }

  private buildIndex(snapshot: StopIndex["snapshot"], reads: PromiseSettledResult<RegistryRoute | null>[], failed: PromiseRejectedResult | undefined): StopIndex {
    const routes = reads.flatMap((read): RegistryRoute[] => (read.status === "fulfilled" && read.value !== null ? [read.value] : []));
    const index: StopIndex = { ...toStopIndex(snapshot, routes), ...(failed && { registryFailure: failed.reason }) };
    if (!failed) this.warnUnmatchedAliases(index);
    if (!failed) this.warnUnmatchedStopAreaMembers(index);
    return index;
  }

  // WHY: an aliased pole is the dataset's, so its local stop still serves while the registry that lists it cannot be read.
  private aliasOwnerWhileUnread(index: StopIndex, stopId: string): string | undefined {
    return index.registryFailure === undefined ? undefined : toCanonicalStopId(index.snapshot, stopId);
  }

  // WHY: only a pole (its `seoul-<arsId>` alias, or an id with no letter, which no slug is), or a local stop standing for one, may be
  // served by a route the index left out; any other id is gone.
  private isPoleOrAliasing(index: StopIndex, stopId: string): boolean {
    return toPoleArsId(stopId) !== null || !SLUG_LETTER_PATTERN.test(stopId) || hasPoleAliases(index.snapshot, stopId);
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

  private async readRoutePathsOrNone(): Promise<RoutePaths | null> {
    try {
      return await this.routePaths.listRoutePaths();
    } catch (err) {
      const ticket = this.logThrottle.take("coords");
      if (ticket) logger.warn({ event: "bus.stop_index.coords_unavailable", suppressed: ticket.suppressed, err }, "Route lines unreadable; stops listed without pole coordinates");
      return null;
    }
  }

  private logUnreadRoutes(reads: PromiseSettledResult<RegistryRoute | null>[]): void {
    const routeIds = TOPIS_ROUTES.filter((_route, index) => reads[index]?.status === "rejected").map((route) => route.id);
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
  private warnUnmatchedAliases({ snapshot: { revision }, unmatchedArsIds, unmatchedTopisIds }: StopIndex): void {
    if (unmatchedArsIds.length + unmatchedTopisIds.length === 0 || this.warnedRevisions.has(revision)) return;
    this.warnedRevisions.add(revision);
    logger.warn(
      { event: "bus.stop_index.alias_unmatched", revision, arsIds: unmatchedArsIds, topisIds: unmatchedTopisIds },
      "A stop aliases an ARS number or TOPIS station no stored station has, or a pole another stop's TOPIS alias claims",
    );
  }

  // WHY: TOPIS drops a pole at runtime, which a push could not foresee; the area serves its other members (ADR 0022, D4).
  private warnUnmatchedStopAreaMembers({ snapshot: { revision }, unmatchedStopAreaMembers: members }: StopIndex): void {
    const ticket = members.length > 0 ? this.logThrottle.take("stop_area_members") : null;
    if (ticket) {
      logger.warn(
        { event: "bus.stop_index.stop_area_member_unmatched", revision, stopAreaIds: [...new Set(members.map((member) => member.stopAreaId))], memberIds: members.map((member) => member.memberId), suppressed: ticket.suppressed },
        "A stop area lists a stop the stop index cannot find; left out of the area",
      );
    }
  }
}
