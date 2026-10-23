import { Controller, Get, UseInterceptors } from "@nestjs/common";
import { EtagInterceptor } from "../../http/etag.interceptor";
import type { WithEtag } from "../../http/response.types";
import { BusStopListService } from "./bus-stop-list.service";
import type { BusStopList } from "./bus-stop-list.wire";

@Controller("bus/stops")
export class BusStopListController {
  constructor(private readonly stopList: BusStopListService) {}

  // WHY: Cache-Control depends on the answer, which @CacheControl cannot express, so withEtag carries it.
  @Get()
  @UseInterceptors(EtagInterceptor)
  listStops(): Promise<WithEtag<BusStopList>> {
    return this.stopList.listStops();
  }
}
