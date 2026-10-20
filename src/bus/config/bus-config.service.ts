import { Injectable } from "@nestjs/common";
import crypto from "crypto";
import { WEBVIEW_ORIGIN } from "../../infra/origins";
import type { SupportedLang } from "../../infra/types";
import { JONGRO_ROUTES } from "../bus.constants";
import { BusRegistryService } from "../registry/bus-registry.service";
import type { RegistryRoute } from "../registry/bus-registry.types";
import { BusStopsService } from "../stops/bus-stops.service";
import { HAS_STOP_MAPS_BY_GROUP } from "./bus-config.config";
import { CAMPUS_SERVICE_IDS, COMMUTE_SERVICE_IDS } from "./bus-config.constants";
import { toBusGroupIds, toBusGroups } from "./bus-config.mapper";
import type { BusGroup } from "./bus-config.wire";

@Injectable()
export class BusConfigService {
  private readonly etagCache = new Map<string, string>();

  constructor(
    private readonly stops: BusStopsService,
    private readonly registry: BusRegistryService,
  ) {}

  // WHY: route ids never change at runtime, so the ids need no registry read and serve a boot-time check.
  listGroupIds(): string[] {
    return toBusGroupIds(JONGRO_ROUTES);
  }

  async getBusGroups(lang: SupportedLang = "ko"): Promise<BusGroup[]> {
    return this.toGroups(lang, await this.registry.listRoutes());
  }

  // WHY: keyed by every route's stations version too, so a sync changes the ETag (improve-jongro-realtime D10).
  async computeEtag(lang: SupportedLang = "ko"): Promise<string> {
    const routes = await this.registry.listRoutes();
    const cacheKey = [lang, ...routes.map((route) => route.stationsVersion)].join(":");
    const cached = this.etagCache.get(cacheKey);
    if (cached) return cached;
    const etag = this.md5Etag(this.toGroups(lang, routes));
    this.etagCache.set(cacheKey, etag);
    return etag;
  }

  async getGroupById(id: string, lang: SupportedLang = "ko"): Promise<BusGroup | null> {
    return (await this.getBusGroups(lang)).find((g) => g.id === id) || null;
  }

  async computeGroupEtag(id: string, lang: SupportedLang = "ko"): Promise<string | null> {
    const routes = await this.registry.listRoutes();
    const cacheKey = [id, lang, ...routes.map((route) => route.stationsVersion)].join(":");
    const cached = this.etagCache.get(cacheKey);
    if (cached) return cached;
    const group = this.toGroups(lang, routes).find((g) => g.id === id);
    if (!group) return null;
    const etag = this.md5Etag(group);
    this.etagCache.set(cacheKey, etag);
    return etag;
  }

  private toGroups(lang: SupportedLang, routes: readonly RegistryRoute[]): BusGroup[] {
    const stops = {
      campus: this.stops.servedSequences(CAMPUS_SERVICE_IDS, lang, HAS_STOP_MAPS_BY_GROUP.campus),
      commute: this.stops.servedSequences(COMMUTE_SERVICE_IDS, lang, HAS_STOP_MAPS_BY_GROUP.commute),
    };
    return toBusGroups({ lang, stops, jongroRoutes: routes, webviewOrigin: WEBVIEW_ORIGIN });
  }

  private md5Etag(value: unknown): string {
    return `"${crypto.createHash("md5").update(JSON.stringify(value)).digest("hex")}"`;
  }
}
