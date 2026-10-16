import { Controller, Get, Query } from "@nestjs/common";
import { CacheControl } from "../../http/cache-control.decorator";
import { InternalRoute } from "../../http/internal-scope.decorator";
import { ZodValidationPipe } from "../../http/zod-validation.pipe";
import { accuracyQuery } from "./subway-history.schema";
import { SubwayHistoryService } from "./subway-history.service";
import type { AccuracyReport } from "./subway-history.types";

const rangePipe = new ZodValidationPipe(accuracyQuery, "INVALID_ACCURACY_RANGE");

// SEE: docs/reference/subway-api.md ("GET /internal/subway/accuracy"): its own internal token and no limiter,
// as every internal route; the guard runs before the range is read, so a caller without the token learns nothing.
@Controller("internal/subway")
export class SubwayHistoryController {
  constructor(private readonly history: SubwayHistoryService) {}

  @Get("accuracy")
  @CacheControl("no-store")
  @InternalRoute("subway.accuracy")
  async accuracy(@Query() query: unknown): Promise<AccuracyReport> {
    const range = rangePipe.transform(query);
    return { ...range, groups: await this.history.listAccuracyGroups(range) };
  }
}
