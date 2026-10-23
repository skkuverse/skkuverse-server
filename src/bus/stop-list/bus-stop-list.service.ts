import { Injectable } from "@nestjs/common";
import { withEtag } from "../../http/etag.interceptor";
import type { WithEtag } from "../../http/response.types";
import type { SupportedLang } from "../../infra/types";
import { BusStopIndexService } from "../stop-index/bus-stop-index.service";
import type { FoundStop } from "../stop-index/bus-stop-index.types";
import { DEGRADED_STOP_LIST_CACHE_CONTROL, STOP_LIST_CACHE_CONTROL } from "./bus-stop-list.constants";
import { toListedStop } from "./bus-stop-list.mapper";
import { toStopListEtag } from "./bus-stop-list.rules";
import type { LocalizedText } from "./bus-stop-list.types";
import type { BusStopList } from "./bus-stop-list.wire";

// SEE: docs/reference/bus-stops-api.md ("GET /bus/stops"): one body for every language, so a shared cache may keep it.
@Injectable()
export class BusStopListService {
  constructor(private readonly index: BusStopIndexService) {}

  async listStops(): Promise<WithEtag<BusStopList>> {
    const { snapshot, stops, isPartial } = await this.index.listStops();
    const lines = { hsscLine: snapshot.hssc, catalogStops: snapshot.catalog.stops };
    const stopList: BusStopList = { stops: stops.map((stop) => toListedStop(stop, this.recordNamesOf({ ...stop, snapshot }), lines)) };
    return withEtag(stopList, toStopListEtag(stopList), isPartial ? DEGRADED_STOP_LIST_CACHE_CONTROL : STOP_LIST_CACHE_CONTROL);
  }

  // WHY: a local stop is named as its config record in each language, so the list, a stop page and /bus/config cannot drift.
  private recordNamesOf(stop: FoundStop): LocalizedText | null {
    const nameIn = (lang: SupportedLang): string | undefined => this.index.servedRecordOf(stop, lang)?.name;
    const [ko, en, zh] = [nameIn("ko"), nameIn("en"), nameIn("zh")];
    return ko === undefined || en === undefined || zh === undefined ? null : { ko, en, zh };
  }
}
