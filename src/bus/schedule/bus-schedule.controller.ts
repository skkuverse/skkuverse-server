import { Controller, Get, Param, Query, UseInterceptors } from "@nestjs/common";
import { CacheControl } from "../../http/cache-control.decorator";
import { EtagInterceptor } from "../../http/etag.interceptor";
import type { WithEtag } from "../../http/response.types";
import { ZodValidationPipe } from "../../http/zod-validation.pipe";
import { weekQuery } from "./bus-schedule.schema";
import { BusScheduleService } from "./bus-schedule.service";
import type { WeekQuery } from "./bus-schedule.types";
import type { ScheduleWeek } from "./bus-schedule.wire";

@Controller("bus/schedule")
export class BusScheduleController {
  constructor(private readonly schedule: BusScheduleService) {}

  @Get("data/:serviceId/week")
  @UseInterceptors(EtagInterceptor)
  @CacheControl("public, max-age=300")
  getWeek(
    @Param("serviceId") serviceId: string,
    @Query(new ZodValidationPipe(weekQuery, "INVALID_DATE_FORMAT")) query: WeekQuery,
  ): Promise<WithEtag<ScheduleWeek>> {
    return this.schedule.getWeek(serviceId, query.from);
  }
}
