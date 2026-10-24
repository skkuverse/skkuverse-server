import { Controller, Get } from "@nestjs/common";
import { CacheControl } from "../../http/cache-control.decorator";
import { Lang } from "../../http/lang.decorator";
import type { SupportedLang } from "../../infra/types";
import { STATION_LIST_CACHE_CONTROL } from "./subway-station-list.constants";
import { SubwayStationListService } from "./subway-station-list.service";
import type { SubwayStationList } from "./subway-station-list.wire";

@Controller("subway/stations")
export class SubwayStationListController {
  constructor(private readonly stationList: SubwayStationListService) {}

  @Get()
  @CacheControl(STATION_LIST_CACHE_CONTROL)
  listStations(@Lang() lang: SupportedLang): Promise<SubwayStationList> {
    return this.stationList.listStations(lang);
  }
}
