import { Injectable } from "@nestjs/common";
import logger from "../../infra/logger";
import type { SupportedLang } from "../../infra/types";
import type { LatLng } from "../../shared/lat-lng.types";
import type { ServedStop } from "../bus.wire";
import { JONGRO_ROUTES } from "../bus.constants";
import { BusRegistryService } from "../registry/bus-registry.service";
import type { RegistryRoute } from "../registry/bus-registry.types";
import { BusRoutePathService } from "../route-path/bus-route-path.service";
import { BusStopsService } from "../stops/bus-stops.service";
import { toPoleCoords } from "./bus-stop-index.mapper";
import { toPoleArsId, toStopIndex } from "./bus-stop-index.rules";
import type { FoundStop, IndexedStop, StopIndex } from "./bus-stop-index.types";

// SEE: docs/explanation/bus-architecture.md ("Glossary"): the stop index, derived at read and never stored.
@Injectable()
export class BusStopIndexService {
  // WHY: keyed by the stops' revision and every route's stations version, so a push or a TOPIS sync rebuilds it
  // within its source's TTL (ADR 0013 D6, "a derived cache keeps the bound").
  private built: { key: string; index: StopIndex } | null = null;
  private readonly warnedRevisions = new Set<number>();

  constructor(
    private readonly stops: BusStopsService,
    private readonly registry: BusRegistryService,
    private readonly routePaths: BusRoutePathService,
  ) {}

  async findStop(stopId: string): Promise<FoundStop | null> {
    const index = await this.current();
    const arsId = toPoleArsId(stopId);
    const canonicalId = arsId === null ? stopId : index.stopIdByArsId.get(arsId);
    const stop = canonicalId === undefined ? undefined : index.stopById.get(canonicalId);
    if (stop) return { ...stop, snapshot: index.snapshot, coords: stop.localStop?.coords ?? (await this.poleCoordsOf(stop)) };
    if (arsId !== null && index.registryFailure !== undefined) throw index.registryFailure;
    return null;
  }

  // WHY: a local stop is served as its config record, so a stop page and /bus/config cannot drift; a pole has none.
  servedRecordOf(stop: FoundStop, lang: SupportedLang): ServedStop | null {
    return stop.localStop && this.stops.servedStop(stop.localStop, lang);
  }

  private async current(): Promise<StopIndex> {
    const snapshot = await this.stops.current();
    const reads = await Promise.allSettled(JONGRO_ROUTES.map((route) => this.registry.routeOf(route.id)));
    const key = [snapshot.revision, ...reads.map((read) => (read.status === "fulfilled" ? read.value.stationsVersion : "unread"))].join(":");
    if (this.built?.key === key) return this.built.index;
    const routes = reads.flatMap((read): RegistryRoute[] => (read.status === "fulfilled" ? [read.value] : []));
    const failed = reads.find((read): read is PromiseRejectedResult => read.status === "rejected");
    const index: StopIndex = { ...toStopIndex(snapshot, routes), ...(failed && { registryFailure: failed.reason }) };
    if (!failed) this.warnUnmatchedAliases(index);
    this.built = { key, index };
    return index;
  }

  // WHY: a map pin is optional on a stop page, so a route line that cannot be read leaves it out; the line's own read logs why.
  private async poleCoordsOf(stop: IndexedStop): Promise<LatLng | null> {
    if (stop.poles.length === 0) return null;
    try {
      return toPoleCoords(stop.poles, (await this.routePaths.listRoutePaths()).routePaths);
    } catch (err) {
      logger.warn({ event: "bus.stop_index.coords_unavailable", stopId: stop.id, err }, "Route lines unreadable; stop served without coordinates");
      return null;
    }
  }

  // WHY: stations change at runtime, so an alias no stored station has is a warning once per revision, not a refusal.
  private warnUnmatchedAliases({ snapshot: { revision }, unmatchedArsIds }: StopIndex): void {
    if (unmatchedArsIds.length === 0 || this.warnedRevisions.has(revision)) return;
    this.warnedRevisions.add(revision);
    logger.warn({ event: "bus.stop_index.alias_unmatched", revision, arsIds: unmatchedArsIds }, "A stop aliases an ARS number no stored station has");
  }
}
