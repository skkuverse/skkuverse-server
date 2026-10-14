import { Controller, Get, Param, UseInterceptors } from "@nestjs/common";
import { EtagInterceptor } from "../../../http/etag.interceptor";
import { Lang } from "../../../http/lang.decorator";
import type { WithEtag } from "../../../http/response.types";
import type { SupportedLang } from "../../../infra/types";
import type { SmartSchedule } from "../../schedule/bus-schedule.wire";
import { BusEtaSmartService } from "./bus-eta-smart.service";

@Controller("bus/schedule")
export class BusEtaSmartController {
  constructor(private readonly smart: BusEtaSmartService) {}

  @Get("data/:serviceId/smart")
  @UseInterceptors(EtagInterceptor)
  getSmart(@Param("serviceId") serviceId: string, @Lang() lang: SupportedLang): Promise<WithEtag<SmartSchedule>> {
    return this.smart.getSmart(serviceId, lang);
  }
}
