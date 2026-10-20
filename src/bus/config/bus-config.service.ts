import { Injectable } from "@nestjs/common";
import crypto from "crypto";
import { WEBVIEW_ORIGIN } from "../../infra/origins";
import logger from "../../infra/logger";
import type { SupportedLang } from "../../infra/types";
import { JONGRO_ROUTES } from "../bus.constants";
import { BusRegistryService } from "../registry/bus-registry.service";
import type { RegistryRoute } from "../registry/bus-registry.types";
import { BusRouteAttributesService } from "../route-attributes/bus-route-attributes.service";
import type { RouteAttributesSnapshot } from "../route-attributes/bus-route-attributes.types";
import { BusStopsService } from "../stops/bus-stops.service";
import { HAS_STOP_MAPS_BY_GROUP } from "./bus-config.config";
import { CAMPUS_SERVICE_IDS, COMMUTE_SERVICE_IDS } from "./bus-config.constants";
import { toBusGroupIds, toBusGroups } from "./bus-config.mapper";
import type { AttributedJongroRoute } from "./bus-config.types";
import type { BusGroup } from "./bus-config.wire";

interface GroupSources {
  routes: RegistryRoute[];
  attributes: RouteAttributesSnapshot | null;
}

// WHY: with no attributes read, no Jongro group is built, so the registry is not read either (move-reference-datasets D10).
const NO_JONGRO_SOURCES: GroupSources = { routes: [], attributes: null };

@Injectable()
export class BusConfigService {
  private readonly etagCache = new Map<string, string>();
  private readonly warnedTransferKeys = new Set<string>();

  constructor(
    private readonly stops: BusStopsService,
    private readonly registry: BusRegistryService,
    private readonly routeAttributes: BusRouteAttributesService,
  ) {}

  // WHY: route ids never change at runtime, so the ids need no registry read and serve a boot-time check.
  listGroupIds(): string[] {
    return toBusGroupIds(JONGRO_ROUTES);
  }

  async getBusGroups(lang: SupportedLang = "ko"): Promise<BusGroup[]> {
    return this.toGroups(lang, await this.readSources());
  }

  // WHY: keyed by the attributes revision and every route's stations version, so a push or a sync changes the ETag.
  async computeEtag(lang: SupportedLang = "ko"): Promise<string> {
    const sources = await this.readSources();
    const cacheKey = [lang, sources.attributes?.revision ?? "none", ...sources.routes.map((route) => route.stationsVersion)].join(":");
    const cached = this.etagCache.get(cacheKey);
    if (cached) return cached;
    const etag = this.md5Etag(this.toGroups(lang, sources));
    this.etagCache.set(cacheKey, etag);
    return etag;
  }

  async getGroupById(id: string, lang: SupportedLang = "ko"): Promise<BusGroup | null> {
    return this.toGroups(lang, await this.readGroupSources(id)).find((g) => g.id === id) || null;
  }

  async computeGroupEtag(id: string, lang: SupportedLang = "ko"): Promise<string | null> {
    const sources = await this.readGroupSources(id);
    const cacheKey = [id, lang, sources.attributes?.revision ?? "none", ...sources.routes.map((route) => route.stationsVersion)].join(":");
    const cached = this.etagCache.get(cacheKey);
    if (cached) return cached;
    const group = this.toGroups(lang, sources).find((g) => g.id === id);
    if (!group) return null;
    const etag = this.md5Etag(group);
    this.etagCache.set(cacheKey, etag);
    return etag;
  }

  private async readSources(): Promise<GroupSources> {
    const attributes = await this.routeAttributes.findCurrent();
    return attributes === null ? NO_JONGRO_SOURCES : { attributes, routes: await this.registry.listRoutes() };
  }

  // WHY: a Jongro group answers its realtime route's 503 when the attributes were never read or lack its route
  // (move-reference-datasets D10); any other group reads no Jongro data.
  private async readGroupSources(id: string): Promise<GroupSources> {
    const isJongroGroup = JONGRO_ROUTES.some((route) => route.id === id);
    if (!isJongroGroup) return NO_JONGRO_SOURCES;
    await this.routeAttributes.attributesOf(id);
    return { attributes: await this.routeAttributes.current(), routes: await this.registry.listRoutes() };
  }

  private toGroups(lang: SupportedLang, { routes, attributes }: GroupSources): BusGroup[] {
    const stops = {
      campus: this.stops.servedSequences(CAMPUS_SERVICE_IDS, lang, HAS_STOP_MAPS_BY_GROUP.campus),
      commute: this.stops.servedSequences(COMMUTE_SERVICE_IDS, lang, HAS_STOP_MAPS_BY_GROUP.commute),
    };
    return toBusGroups({ lang, stops, jongroRoutes: this.toAttributedRoutes(routes, attributes), webviewOrigin: WEBVIEW_ORIGIN });
  }

  // WHY: a route without stored attributes is left out (BusRouteAttributesService logs the gap once per revision).
  private toAttributedRoutes(routes: readonly RegistryRoute[], snapshot: RouteAttributesSnapshot | null): AttributedJongroRoute[] {
    if (snapshot === null) return [];
    return routes.flatMap((route) => {
      const attributes = snapshot.attributesOf(route.id);
      if (attributes === undefined) return [];
      this.warnUnmatchedTransferLines({ route, attributes }, snapshot.revision);
      return [{ route, attributes }];
    });
  }

  // WHY: stations change at runtime, so an entry no stored station has is a warning once per revision, not a refusal.
  private warnUnmatchedTransferLines({ route, attributes }: AttributedJongroRoute, revision: number): void {
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
