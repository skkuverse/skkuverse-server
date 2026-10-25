import { Controller, Get, Query } from "@nestjs/common";
import { CacheControl } from "../../http/cache-control.decorator";
import { Lang } from "../../http/lang.decorator";
import { withMeta } from "../../http/response.interceptor";
import type { WithMeta } from "../../http/response.types";
import { ZodValidationPipe } from "../../http/zod-validation.pipe";
import type { SupportedLang } from "../../infra/types";
import { overviewRequest, type OverviewQuery } from "./notices-overview.schema";
import { NoticesOverviewService } from "./notices-overview.service";
import type { OverviewData, OverviewMeta } from "./notices-overview.wire";

// WHY: a request apart from the list, so the list never waits on the LLM; one segment, so the detail route
// `:sourceId/:articleNo` cannot catch it.
@Controller("notices")
export class NoticesOverviewController {
  constructor(private readonly overview: NoticesOverviewService) {}

  @Get("overview")
  @CacheControl("no-store")
  async getOverview(
    @Query(new ZodValidationPipe(overviewRequest, "INVALID_PARAMS")) query: OverviewQuery,
    @Lang() lang: SupportedLang,
  ): Promise<WithMeta<OverviewData, OverviewMeta>> {
    const { overview, meta } = await this.overview.getOverview({ ...query, lang });
    return withMeta({ overview }, meta);
  }
}
