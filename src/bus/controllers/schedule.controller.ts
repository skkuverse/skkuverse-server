import { Controller, Get, Param, Query, Req, Res } from "@nestjs/common";
import crypto from "crypto";
import type { Request, Response } from "express";
import { t } from "../../infra/i18n";
import logger from "../../infra/logger";
import type { SupportedLang } from "../../infra/types";
import { ScheduleService, type SmartScheduleResult } from "../schedule/schedule.service";
import { stopCatalog } from "../schedule/schedule-stops";
import serviceConfig from "../schedule/service-config";
import { applyEstimates } from "../eta/apply-estimates";
import { ShuttleEtaService } from "../eta/shuttle-eta.service";
import { AppError } from "../../common/app-error";
import { sendSuccess } from "../../common/send-success";
import { createLogThrottle } from "../../infra/log-throttle";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Both endpoints use @Res() for ETag/304 control. The 304 path is
 * `res.status(304).end()` — NO body, NO envelope, NO X-Response-Time, NO
 * ETag/Cache-Control re-set. Cache-Control is public, max-age=300, or 60 for a
 * smart schedule that carries arrival estimates.
 */
// Still called by old app builds; an hourly line per service with a count of
// the calls in between says how many remain without a line per request.
const weekCallThrottle = createLogThrottle(60 * 60_000);
// A store outage would otherwise warn on every smart request.
const etaReadThrottle = createLogThrottle(60 * 60_000);

@Controller("bus/schedule")
export class ScheduleController {
  constructor(
    private readonly schedule: ScheduleService,
    private readonly eta: ShuttleEtaService,
  ) {}

  /**
   * GET /bus/schedule/data/:serviceId/week?from=YYYY-MM-DD
   */
  @Get("data/:serviceId/week")
  async getWeek(
    @Param("serviceId") serviceId: string,
    // `?from=A&from=B` arrives as string[], passed to DATE_RE.test() which
    // coerces to "A,B" → fails → 400. Read as `any` and pass through
    // unchanged — NO type guard / narrowing.
    @Query("from") from: any,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // pino-http attaches `log` to req. Fail-loud on purpose: if req.log is
    // undefined this throws → 500 (see the `log` note in infra/types.ts).
    const ticket = weekCallThrottle.take(serviceId);
    if (ticket) {
      req.log.warn(
        { event: "bus.schedule.week_endpoint_called", serviceId, suppressed: ticket.suppressed },
        "deprecated: /week endpoint called, use /smart",
      );
    }

    if (from !== undefined && !DATE_RE.test(from)) {
      throw new AppError(
        "INVALID_DATE_FORMAT",
        "from must be YYYY-MM-DD",
        400,
      );
    }

    if (!serviceConfig[serviceId]) {
      throw new AppError(
        "SERVICE_NOT_FOUND",
        `Unknown serviceId: ${serviceId}`,
        404,
      );
    }

    const data = await this.schedule.resolveWeek(serviceId, from);
    if (!data) {
      throw new AppError(
        "SERVICE_NOT_FOUND",
        `Unknown serviceId: ${serviceId}`,
        404,
      );
    }

    const bodyJson = JSON.stringify(data);
    const hash = crypto.createHash("md5").update(bodyJson).digest("hex");
    const etag = `"week-${serviceId}-${data.from}-${hash}"`;

    if (req.headers["if-none-match"] === etag) {
      res.status(304).end();
      return;
    }

    res.set("ETag", etag);
    res.set("Cache-Control", "public, max-age=300");
    sendSuccess(req, res, data);
  }

  /**
   * GET /bus/schedule/data/:serviceId/smart
   */
  @Get("data/:serviceId/smart")
  async getSmart(
    @Param("serviceId") serviceId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!serviceConfig[serviceId]) {
      throw new AppError(
        "SERVICE_NOT_FOUND",
        `Unknown serviceId: ${serviceId}`,
        404,
      );
    }

    const resolved = await this.schedule.resolveSmartSchedule(serviceId);
    if (!resolved) {
      throw new AppError(
        "SERVICE_NOT_FOUND",
        `Unknown serviceId: ${serviceId}`,
        404,
      );
    }

    // Applied to a copy after the schedule cache and before hashing, so the
    // ETag follows the estimates. /week is deprecated and gets none.
    const etaRouteTypes = serviceConfig[serviceId]!.eta?.routeTypes;
    const result =
      etaRouteTypes && resolved.status === "active"
        ? await this.withEstimates(resolved, etaRouteTypes)
        : resolved;

    const lang: SupportedLang = (req.lang ?? "ko") as SupportedLang;

    // Spread for immutability; inject i18n message for non-active statuses.
    const data =
      result.status === "active"
        ? { ...result }
        : { ...result, message: t(`schedule.${result.status}`, lang) };

    const bodyJson = JSON.stringify(data);
    const hash = crypto.createHash("md5").update(bodyJson).digest("hex");
    const etag = `"smart-${serviceId}-${data.from || data.status}-${hash}"`;

    if (req.headers["if-none-match"] === etag) {
      res.status(304).end();
      return;
    }

    res.set("ETag", etag);
    res.set("Cache-Control", `public, max-age=${etaRouteTypes ? 60 : 300}`);
    sendSuccess(req, res, data);
  }

  /** The schedule with stored estimates applied; as resolved when they cannot be read. */
  private async withEstimates(
    result: SmartScheduleResult,
    routeTypes: readonly string[],
  ): Promise<SmartScheduleResult> {
    try {
      const estimates = await this.eta.estimates();
      return applyEstimates(result, routeTypes, stopCatalog.sequences[result.serviceId] ?? {}, estimates);
    } catch (err: unknown) {
      const ticket = etaReadThrottle.take(result.serviceId);
      if (ticket) {
        logger.warn(
          { event: "bus.eta.read_failed", serviceId: result.serviceId, suppressed: ticket.suppressed, err },
          "arrival estimates unavailable, serving the stored timetable",
        );
      }
      return result;
    }
  }
}
