import { Injectable } from "@nestjs/common";
import { SERVICE_CONFIG } from "../bus.constants";
import { stopCatalog } from "./bus-stops.config";
import type { SupportedLang } from "../../infra/types";
import { resolveStopSequences } from "./bus-stops.mapper";
import { etaOptIns } from "./bus-stops.rules";
import type { EtaOptIns, ResolvedStops, ScheduleStopCatalog } from "./bus-stops.types";

@Injectable()
export class BusStopsService {
  catalog(): Readonly<ScheduleStopCatalog> {
    return stopCatalog;
  }

  servedSequences(serviceIds: readonly string[], lang: SupportedLang): ResolvedStops {
    return resolveStopSequences(serviceIds, lang, stopCatalog);
  }

  etaOptIns(): EtaOptIns {
    return etaOptIns(SERVICE_CONFIG);
  }
}
