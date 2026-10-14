import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { InternalRoute } from "../../http/internal-scope.decorator";
import logger from "../../infra/logger";
import { NoticesDispatchService } from "./notices-dispatch.service";
import type { DispatchPing } from "./notices-dispatch.types";
import type { SweepSummary } from "./notices-dispatch.wire";

// CONTRACT(skkuverse-crawler): its cycle-end ping (skkuverse-crawler/py/src/skkuverse_crawler/plugins/dispatch/client.py) reads only processed,
// sent and failed; the body is log correlation only. No auth middleware and no limiter: the caller is the crawler.
@Controller("internal/notices")
export class NoticesDispatchController {
  constructor(private readonly dispatch: NoticesDispatchService) {}

  // WHY: 200, not Nest's 201 for a POST, as every internal route answers.
  @Post("dispatch-pending")
  @HttpCode(200)
  @InternalRoute("notices.dispatch")
  async dispatchPending(@Body() body: DispatchPing | undefined): Promise<SweepSummary> {
    const ping = body || {};
    const triggerSource = typeof ping.source === "string" && ping.source ? ping.source : "internal";
    logger.debug(
      { event: "notices.dispatch.ping_received", source: triggerSource, cycleId: ping.cycleId, crawledAt: ping.crawledAt },
      "Dispatch ping received",
    );
    return this.dispatch.sweepPending(triggerSource);
  }
}
