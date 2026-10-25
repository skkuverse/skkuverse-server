import { Injectable } from "@nestjs/common";
import crypto from "crypto";
import { WEBVIEW_ORIGIN } from "../../infra/origins";
import logger from "../../infra/logger";
import type { SupportedLang } from "../../infra/types";
import { TOPIS_ROUTES } from "../bus.constants";
import { BusRegistryService } from "../registry/bus-registry.service";
import type { RegistryRoute } from "../registry/bus-registry.types";
import { BusRouteAttributesService } from "../route-attributes/bus-route-attributes.service";
import type { RouteAttributesSnapshot } from "../route-attributes/bus-route-attributes.types";
import type { RoutePathStation } from "../route-path/bus-route-path.document";
import { BusRoutePathService } from "../route-path/bus-route-path.service";
import { BusStopsService } from "../stops/bus-stops.service";
import type { BusStopsSnapshot } from "../stops/bus-stops.types";
import { HAS_STOP_MAPS_BY_GROUP } from "./bus-config.config";
import { CAMPUS_SERVICE_IDS, COMMUTE_SERVICE_IDS, STOP_GROUP_IDS } from "./bus-config.constants";
import { toBusGroupIds, toBusGroups } from "./bus-config.mapper";
import { toJongroDirections, toLineStationDirection, toStationDirection } from "./bus-config.rules";
import type { AttributedJongroRoute, PlacedStation, StationDirection } from "./bus-config.types";
import type { BusGroup } from "./bus-config.wire";

interface GroupSources {
  routes: RegistryRoute[];
  attributes: RouteAttributesSnapshot | null;
  stops: BusStopsSnapshot;
  /** WHY: each stored route line's stations by route id, which carry TOPIS's direction; none for a route without one. */
  pathStationsByRouteId: ReadonlyMap<string, readonly RoutePathStation[]>;
}

type JongroSources = Omit<GroupSources, "stops">;

// WHY: with no attributes read, no Jongro group is built, so the registry is not read either (ADR 0013, D6).
const NO_JONGRO_SOURCES: JongroSources = { routes: [], attributes: null, pathStationsByRouteId: new Map() };

// WHY: a group that reads no stops is built beside shuttle groups from none, which its lookup by id drops.
const NO_STOPS: BusStopsSnapshot = { revision: 0, catalog: { stops: [], sequences: {} }, hssc: [], stopIdByArsId: new Map(), stopIdByTopisId: new Map(), stopAreas: [] };

@Injectable()
export class BusConfigService {
  private readonly etagCache = new Map<string, string>();
  private readonly warnedTransferKeys = new Set<string>();

  constructor(
    private readonly stops: BusStopsService,
    private readonly registry: BusRegistryService,
    private readonly routeAttributes: BusRouteAttributesService,
    private readonly routePaths: BusRoutePathService,
  ) {}

  // WHY: route ids never change at runtime, so the ids need no registry read and serve a boot-time check.
  listGroupIds(): string[] {
    return toBusGroupIds(TOPIS_ROUTES);
  }

  async getBusGroups(lang: SupportedLang = "ko"): Promise<BusGroup[]> {
    return this.toGroups(lang, await this.readSources());
  }

  // WHY: keyed by both datasets' revisions, every route's stations version and its directions, so a push or either
  // sync changes the ETag.
  async computeEtag(lang: SupportedLang = "ko"): Promise<string> {
    const sources = await this.readSources();
    const cacheKey = [lang, sources.attributes?.revision ?? "none", sources.stops.revision, ...this.routeKeysOf(sources, lang)].join(":");
    const cached = this.etagCache.get(cacheKey);
    if (cached) return cached;
    const etag = this.md5Etag(this.toGroups(lang, sources));
    this.etagCache.set(cacheKey, etag);
    return etag;
  }

  async getGroupById(id: string, lang: SupportedLang = "ko"): Promise<BusGroup | null> {
    return this.toGroups(lang, await this.readGroupSources(id)).find((g) => g.id === id) || null;
  }

  // WHY: a direction adds to a stop page entry, so a group that cannot be built (another route's registry missing)
  // names none; the registry and the attributes log their own failures. An unlisted route has no group to build.
  async findStationDirection(id: string, { stationIndex, stationsVersion }: PlacedStation, lang: SupportedLang): Promise<StationDirection | null> {
    if (TOPIS_ROUTES.some((route) => route.id === id && !route.isListed)) return this.findUnlistedStationDirection(id, { stationIndex, stationsVersion }, lang).catch(() => null);
    const group = await this.getGroupById(id, lang).catch(() => null);
    return toStationDirection(group, stationIndex, stationsVersion);
  }

  async computeGroupEtag(id: string, lang: SupportedLang = "ko"): Promise<string | null> {
    const sources = await this.readGroupSources(id);
    const cacheKey = [id, lang, sources.attributes?.revision ?? "none", sources.stops.revision, ...this.routeKeysOf(sources, lang)].join(":");
    const cached = this.etagCache.get(cacheKey);
    if (cached) return cached;
    const group = this.toGroups(lang, sources).find((g) => g.id === id);
    if (!group) return null;
    const etag = this.md5Etag(group);
    this.etagCache.set(cacheKey, etag);
    return etag;
  }

  private async findUnlistedStationDirection(id: string, { stationIndex, stationsVersion }: PlacedStation, lang: SupportedLang): Promise<StationDirection | null> {
    const [route, routePath] = await Promise.all([this.registry.routeOf(id), this.routePaths.findRoutePath(id)]);
    if (route.stationsVersion !== stationsVersion) return null;
    return toLineStationDirection(toJongroDirections(route.registryStations, routePath?.stations, lang), stationIndex);
  }

  private async readSources(): Promise<GroupSources> {
    const stops = await this.stops.current();
    const attributes = await this.routeAttributes.findCurrent();
    if (attributes === null) return { ...NO_JONGRO_SOURCES, stops };
    return { attributes, routes: await this.registry.listRoutes(), stops, pathStationsByRouteId: await this.readPathStations() };
  }

  // WHY: a Jongro group answers its realtime route's 503 when the attributes were never read or lack its route
  // (ADR 0013, D6), and a group that names stops, a Jongro one's by alias, the stops' 503 when they were never read.
  private async readGroupSources(id: string): Promise<GroupSources> {
    const isJongroGroup = TOPIS_ROUTES.some((route) => route.isListed && route.id === id);
    const stops = isJongroGroup || STOP_GROUP_IDS.includes(id) ? await this.stops.current() : NO_STOPS;
    if (!isJongroGroup) return { ...NO_JONGRO_SOURCES, stops };
    await this.routeAttributes.attributesOf(id);
    return { attributes: await this.routeAttributes.current(), routes: await this.registry.listRoutes(), stops, pathStationsByRouteId: await this.readPathStations() };
  }

  // WHY: directions add to a line, so lines that cannot be read serve none rather than fail the config;
  // BusRoutePathService logs every failed read and each missing line before it answers.
  private async readPathStations(): Promise<Map<string, readonly RoutePathStation[]>> {
    const routePaths = await this.routePaths.listRoutePaths().catch(() => null);
    return new Map(routePaths?.routePaths.map((routePath) => [routePath.routeId, routePath.stations]));
  }

  private routeKeysOf({ routes, pathStationsByRouteId }: GroupSources, lang: SupportedLang): string[] {
    return routes.map((route) => `${route.stationsVersion}/${JSON.stringify(toJongroDirections(route.registryStations, pathStationsByRouteId.get(route.id), lang))}`);
  }

  private toGroups(lang: SupportedLang, { routes, attributes, stops, pathStationsByRouteId }: GroupSources): BusGroup[] {
    const served = {
      campus: this.stops.servedSequences(stops, CAMPUS_SERVICE_IDS, { lang, hasStopMaps: HAS_STOP_MAPS_BY_GROUP.campus }),
      commute: this.stops.servedSequences(stops, COMMUTE_SERVICE_IDS, { lang, hasStopMaps: HAS_STOP_MAPS_BY_GROUP.commute }),
    };
    const jongroRoutes = this.toAttributedRoutes(routes, attributes).map((jongroRoute) => ({
      ...jongroRoute,
      directions: toJongroDirections(jongroRoute.route.registryStations, pathStationsByRouteId.get(jongroRoute.route.id), lang),
    }));
    return toBusGroups({ lang, stops: served, hsscStations: stops.hssc, stopIdByArsId: stops.stopIdByArsId, jongroRoutes, webviewOrigin: WEBVIEW_ORIGIN });
  }

  // WHY: a route without stored attributes is left out (BusRouteAttributesService logs the gap once per revision).
  private toAttributedRoutes(routes: readonly RegistryRoute[], snapshot: RouteAttributesSnapshot | null): Array<Omit<AttributedJongroRoute, "directions">> {
    if (snapshot === null) return [];
    return routes.flatMap((route) => {
      const attributes = snapshot.attributesOf(route.id);
      if (attributes === undefined) return [];
      this.warnUnmatchedTransferLines({ route, attributes }, snapshot.revision);
      return [{ route, attributes }];
    });
  }

  // WHY: stations change at runtime, so an entry no stored station has is a warning once per revision, not a refusal.
  private warnUnmatchedTransferLines({ route, attributes }: Omit<AttributedJongroRoute, "directions">, revision: number): void {
    const arsIds = new Set(route.stations.map((station) => station.stationNumber));
    const isNew = (arsId: string) => !arsIds.has(arsId) && !this.warnedTransferKeys.has(`${revision}:${route.id}:${arsId}`);
    const unmatched = Object.keys(attributes.transferLinesByArsId).filter(isNew);
    if (unmatched.length === 0) return;
    for (const arsId of unmatched) this.warnedTransferKeys.add(`${revision}:${route.id}:${arsId}`);
    logger.warn(
      { event: "bus.jongro.registry_unmatched_transfer", routeId: route.id, revision, arsIds: unmatched },
      "A stored transfer line names an ARS number no stored station has",
    );
  }

  private md5Etag(value: unknown): string {
    return `"${crypto.createHash("md5").update(JSON.stringify(value)).digest("hex")}"`;
  }
}
