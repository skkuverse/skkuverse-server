import { Controller, Get, Param, Query, Req, UseInterceptors } from "@nestjs/common";
import type { Request } from "express";
import { CacheControl } from "../../http/cache-control.decorator";
import { EtagInterceptor } from "../../http/etag.interceptor";
import type { WithEtag } from "../../http/response.types";
import { BusScheduleService } from "./bus-schedule.service";
import type { ScheduleWeek } from "./bus-schedule.wire";

@Controller("bus/schedule")
export class BusScheduleController {
  constructor(private readonly schedule: BusScheduleService) {}

  // QUIRK(express): `?from=A&from=B` arrives as an array, which the date check reads as "A,B" and refuses.
  @Get("data/:serviceId/week")
  @UseInterceptors(EtagInterceptor)
  @CacheControl("public, max-age=300")
  getWeek(@Param("serviceId") serviceId: string, @Query("from") from: unknown, @Req() req: Request): Promise<WithEtag<ScheduleWeek>> {
    return this.schedule.getWeek(serviceId, from, req.log);
  }
}
