import { Injectable } from "@nestjs/common";
import crypto from "crypto";
import { WEBVIEW_ORIGIN } from "../../infra/origins";
import type { SupportedLang } from "../../infra/types";
import { jongroRoutes } from "../bus.config";
import { BusStopsService } from "../stops/bus-stops.service";
import { CAMPUS_SERVICE_IDS, COMMUTE_SERVICE_IDS } from "./bus-config.constants";
import { toBusGroups } from "./bus-config.mapper";
import type { BusGroup } from "./bus-config.wire";

@Injectable()
export class BusConfigService {
  private readonly etagCache = new Map<string, string>();

  constructor(private readonly stops: BusStopsService) {}

  getBusGroups(lang: SupportedLang = "ko"): BusGroup[] {
    const stops = {
      campus: this.stops.servedSequences(CAMPUS_SERVICE_IDS, lang),
      commute: this.stops.servedSequences(COMMUTE_SERVICE_IDS, lang),
    };
    return toBusGroups({ lang, stops, jongroRoutes, webviewOrigin: WEBVIEW_ORIGIN });
  }

  computeEtag(lang: SupportedLang = "ko"): string {
    const cached = this.etagCache.get(lang);
    if (cached) return cached;
    const etag = this.md5Etag(this.getBusGroups(lang));
    this.etagCache.set(lang, etag);
    return etag;
  }

  getGroupById(id: string, lang: SupportedLang = "ko"): BusGroup | null {
    return this.getBusGroups(lang).find((g) => g.id === id) || null;
  }

  computeGroupEtag(id: string, lang: SupportedLang = "ko"): string | null {
    const cacheKey = `${id}:${lang}`;
    const cached = this.etagCache.get(cacheKey);
    if (cached) return cached;
    const group = this.getGroupById(id, lang);
    if (!group) return null;
    const etag = this.md5Etag(group);
    this.etagCache.set(cacheKey, etag);
    return etag;
  }

  private md5Etag(value: unknown): string {
    return `"${crypto.createHash("md5").update(JSON.stringify(value)).digest("hex")}"`;
  }
}
