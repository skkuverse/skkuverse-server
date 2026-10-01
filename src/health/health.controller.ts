import { Controller, Get, Res } from "@nestjs/common";
import type { Response } from "express";
import { ping as pingDb } from "../infra/db";
import logger from "../infra/logger";
import { createLogThrottle } from "../infra/log-throttle";
import { PollerRegistryService } from "../scheduling/poller-registry.service";

/**
 * (An operations detail is left out of the public history.)
 */
const dbDownThrottle = createLogThrottle(60_000);

@Controller("health")
export class HealthController {
  constructor(private readonly pollers: PollerRegistryService) {}

  @Get()
  health(@Res() res: Response): void {
    res.status(200).json({ status: "ok", uptime: process.uptime() });
  }

  @Get("ready")
  async ready(@Res() res: Response): Promise<void> {
    try {
      await pingDb();
      const role = process.env.ROLE || "combined";
      const pollersReady = role === "api" ? true : this.pollers.isReady();
      if (!pollersReady) {
        res
          .status(503)
          .json({ status: "unavailable", reason: "pollers not started" });
        return;
      }
      res.status(200).json({ status: "ready", uptime: process.uptime() });
    } catch (err) {
      const ticket = dbDownThrottle.take("db");
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
