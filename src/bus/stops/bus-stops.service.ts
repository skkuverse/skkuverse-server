import { Injectable } from "@nestjs/common";
import { SERVICE_CONFIG } from "../bus.constants";
import type { SupportedLang } from "../../infra/types";
import { SubwayStationsService } from "../../subway/stations/subway-stations.service";
import type { LocalizedName } from "../../subway/subway.types";
import { readStopCatalog } from "./bus-stops.config";
import { resolveStopSequences } from "./bus-stops.mapper";
import { etaOptIns } from "./bus-stops.rules";
import type { EtaOptIns, ResolvedStops, ScheduleStopCatalog } from "./bus-stops.types";

@Injectable()
export class BusStopsService {
  // WHY: read and checked against the served subway stations when Nest builds the provider, so a bad file fails the boot.
  private readonly stopCatalog: Readonly<ScheduleStopCatalog>;
  private readonly subwayTitles: ReadonlyMap<string, LocalizedName>;

  constructor(stations: SubwayStationsService) {
    this.stopCatalog = readStopCatalog(new Set(stations.listStations().map((station) => station.id)));
    this.subwayTitles = new Map(stations.listStations().map((station) => [station.id, station.title]));
  }

  catalog(): Readonly<ScheduleStopCatalog> {
    return this.stopCatalog;
  }

  servedSequences(serviceIds: readonly string[], lang: SupportedLang, hasStopMaps: boolean): ResolvedStops {
    return resolveStopSequences(serviceIds, lang, { catalog: this.stopCatalog, subwayTitles: this.subwayTitles, hasStopMaps });
  }

  etaOptIns(): EtaOptIns {
    return etaOptIns(SERVICE_CONFIG);
  }
}
