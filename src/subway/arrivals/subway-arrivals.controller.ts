import { Controller, Get, Param } from "@nestjs/common";
import { AppError } from "../../http/app.error";
import { CacheControl } from "../../http/cache-control.decorator";
import { Lang } from "../../http/lang.decorator";
import { ZodValidationPipe } from "../../http/zod-validation.pipe";
import type { SupportedLang } from "../../infra/types";
import { ARRIVALS_CACHE_CONTROL } from "./subway-arrivals.constants";
import { stationIdParam } from "./subway-arrivals.schema";
import { SubwayArrivalsService } from "./subway-arrivals.service";
import type { SubwayStationArrivals } from "./subway-arrivals.wire";

const NOT_FOUND = "SUBWAY_STATION_NOT_FOUND";

@Controller("subway")
export class SubwayArrivalsController {
  constructor(private readonly arrivals: SubwayArrivalsService) {}

  @Get("stations/:stationId/arrivals")
  @CacheControl(ARRIVALS_CACHE_CONTROL)
  async stationArrivals(
    @Param("stationId", new ZodValidationPipe(stationIdParam, NOT_FOUND, { status: 404 })) stationId: string,
    @Lang() lang: SupportedLang,
  ): Promise<SubwayStationArrivals> {
    const arrivals = await this.arrivals.findStationArrivals(stationId, lang);
    if (!arrivals) throw new AppError(NOT_FOUND, `Subway station ${stationId} is not served`, 404);
    return arrivals;
  }
}
