import { Injectable, type OnModuleInit } from "@nestjs/common";
import config from "../../infra/config";
import logger from "../../infra/logger";
import { PollerRegistryService } from "../../scheduling/poller-registry.service";
import { NoticesDispatchService } from "./notices-dispatch.service";

// WHY: a safety net for a lost crawler ping, off unless DISPATCH_SWEEP_ENABLED; on an api replica the registry
// never starts it, and the atomic claim would keep a second sweeper from pushing twice anyway.
@Injectable()
export class NoticesDispatchPoller implements OnModuleInit {
  constructor(
    private readonly registry: PollerRegistryService,
    private readonly dispatch: NoticesDispatchService,
  ) {}

  onModuleInit(): void {
    if (process.env.DISPATCH_SWEEP_ENABLED !== "true") {
      logger.debug({ event: "notices.dispatch.sweep_disabled" }, "DISPATCH_SWEEP_ENABLED not set; safety-net cron disabled (ping-only mode)");
      return;
    }
    this.registry.registerPoller(() => this.dispatch.sweepPending("cron"), config.notices.dispatch.sweepCronIntervalMs, "notices-dispatch-sweep");
  }
}
