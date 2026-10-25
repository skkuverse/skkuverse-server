import { Controller, Get, Res } from "@nestjs/common";
import type { Response } from "express";
import config from "../infra/config";
import { ping as pingDb } from "../infra/db";
import { createLogThrottle } from "../infra/log-throttle";
import logger from "../infra/logger";
import { PollerRegistryService } from "../scheduling/poller-registry.service";

// WHY: every container's healthcheck (30 s) and the uptime monitors probe /health/ready,
// so a database outage logs once a minute instead of once per probe.
const DB_DOWN_LOG_INTERVAL_MS = 60_000;

// WHY: raw JSON through @Res(), not the { meta, data } envelope (ADR 0010, D6): the container
// healthcheck and the deploy's rolling wait gate on the status code alone.
@Controller("health")
export class HealthController {
  private readonly dbDownThrottle = createLogThrottle(DB_DOWN_LOG_INTERVAL_MS);

  constructor(private readonly pollers: PollerRegistryService) {}

  @Get()
  health(@Res() res: Response): void {
    res.status(200).json({ status: "ok", uptime: process.uptime() });
  }

  @Get("ready")
  async ready(@Res() res: Response): Promise<void> {
    try {
      await pingDb();
      const pollersReady = config.runsPollers() ? this.pollers.isReady() : true;
      if (!pollersReady) {
        res.status(503).json({ status: "unavailable", reason: "pollers not started" });
        return;
      }
      res.status(200).json({ status: "ready", uptime: process.uptime() });
    } catch (err) {
      const ticket = this.dbDownThrottle.take("db");
      if (ticket) {
        logger.error(
          { event: "health.db_unreachable", err, suppressed: ticket.suppressed },
          "Readiness check: database unreachable",
        );
      }
      res.status(503).json({ status: "unavailable", reason: "db unreachable" });
    }
  }
}
