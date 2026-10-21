import { Controller, Get, Param } from "@nestjs/common";
import { AppError } from "../../http/app.error";
import { CacheControl } from "../../http/cache-control.decorator";
import { Lang } from "../../http/lang.decorator";
import { ZodValidationPipe } from "../../http/zod-validation.pipe";
import type { SupportedLang } from "../../infra/types";
import { STOP_ARRIVALS_CACHE_CONTROL } from "./bus-stop-arrivals.constants";
import { stopIdParam } from "./bus-stop-arrivals.schema";
import { BusStopArrivalsService } from "./bus-stop-arrivals.service";
import type { BusStopArrivals } from "./bus-stop-arrivals.wire";

const NOT_FOUND = "BUS_STOP_NOT_FOUND";

@Controller("bus/stops")
export class BusStopArrivalsController {
  constructor(private readonly arrivals: BusStopArrivalsService) {}

  @Get(":stopId/arrivals")
  @CacheControl(STOP_ARRIVALS_CACHE_CONTROL)
  async stopArrivals(
    @Param("stopId", new ZodValidationPipe(stopIdParam, NOT_FOUND, { status: 404 })) stopId: string,
    @Lang() lang: SupportedLang,
  ): Promise<BusStopArrivals> {
    const arrivals = await this.arrivals.findStopArrivals(stopId, lang);
    if (!arrivals) throw new AppError(NOT_FOUND, `Bus stop ${stopId} is not served`, 404);
    return arrivals;
  }
}
