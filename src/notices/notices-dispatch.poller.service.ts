import { Injectable, type OnModuleInit } from "@nestjs/common";
import config from "../infra/config";
import logger from "../infra/logger";
import { PollerRegistryService } from "../scheduling/poller-registry.service";
import { NoticesDispatcherService } from "./notices-dispatcher.service";

/**
 * NoticesDispatchPollerService — port of notices.dispatch.poller.ts.
 *
 * Safety-net cron sweep for FCM dispatch. Primary trigger is the crawler's
 * cycle-end ping to the internal route; this cron only recovers when that ping
 * is lost. Registration is gated on DISPATCH_SWEEP_ENABLED === "true" exactly
 * as the Express version — api-only pods (or any pod without the flag) never
 * register the poller and only log the debug "ping-only mode" line.
 *
 * When enabled, registers sweepPending("cron") with the Nest PollerRegistry at
 * config.notices.dispatch.sweepCronIntervalMs (default 30 min), name
 * "notices-dispatch-sweep" — identical interval/name/wrapper as the legacy
 * registerPoller call (notices.dispatch.poller.ts:23-34), including the .catch
 * shape that logs "[dispatch] cron sweep failed".
 *
 * Gating: PollerRegistryService.onApplicationBootstrap only startAll()s when
 * ROLE !== "api" (same as index.ts poller startup), so an api replica that
 * somehow set the flag would register but never run the sweep — and even if it
 * ran, sweepPending's in-process single-flight + cross-instance atomic claim
 * prevent double-dispatch.
 *
 * NOTE — no double-run: the Nest app NEVER imports
 * notices.dispatch.poller (that module's top-level
 * registerPoller side-effect lands in the LEGACY lib/pollers registry, which
 * bootstrap never starts). This service is the single driver, and it registers
 * with THIS Nest PollerRegistry only.
 */
@Injectable()
export class NoticesDispatchPollerService implements OnModuleInit {
  constructor(
    private readonly registry: PollerRegistryService,
    private readonly dispatcher: NoticesDispatcherService,
  ) {}

  onModuleInit(): void {
    if (process.env.DISPATCH_SWEEP_ENABLED === "true") {
      this.registry.registerPoller(
        // A failed sweep is reported by the registry (one per failing spell).
        () => this.dispatcher.sweepPending("cron"),
        config.notices.dispatch.sweepCronIntervalMs,
        "notices-dispatch-sweep",
      );
    } else {
      logger.debug(
        { event: "notices.dispatch.sweep_disabled" },
        "DISPATCH_SWEEP_ENABLED not set; safety-net cron disabled (ping-only mode)",
      );
    }
  }
}
