import { Injectable } from "@nestjs/common";
import crypto from "crypto";
import { AppError } from "../../../http/app.error";
import { withEtag } from "../../../http/etag.interceptor";
import type { WithEtag } from "../../../http/response.types";
import { createCachedLoader } from "../../../infra/cached-loader";
import { Clock } from "../../../infra/clock";
import logger from "../../../infra/logger";
import { createLogThrottle } from "../../../infra/log-throttle";
import type { SupportedLang } from "../../../infra/types";
import { ESTIMATES_MAX_AGE_S } from "../../bus.constants";
import { serviceConfigOf } from "../../bus.rules";
import { BusScheduleService } from "../../schedule/bus-schedule.service";
import type { SmartSchedule } from "../../schedule/bus-schedule.wire";
import { BusStopsService } from "../../stops/bus-stops.service";
import type { ShuttleEtaDoc } from "../bus-eta.document";
import { BusEtaRepository } from "../bus-eta.repository";
import { applyEstimates, withStatusMessage } from "./bus-eta-smart.mapper";
import { pickEstimates } from "./bus-eta-smart.rules";
import type { ServedEstimate } from "./bus-eta-smart.types";

const HOUR_MS = 60 * 60_000;
const MAX_AGE_S = 300;

@Injectable()
export class BusEtaSmartService {
  // WHY: every unexpired document (a few hundred) is read at most once per 30 s per replica, and an outage keeps
  // the last read in service for 10 minutes.
  private readonly docs = createCachedLoader<ShuttleEtaDoc[]>({
    name: "shuttle-eta",
    ttlMs: 30_000,
    staleWindowMs: 10 * 60_000,
    load: () => this.estimates.listUnexpired(this.clock.now()),
  });
  // WHY: a store outage would otherwise warn on every smart request.
  private readonly etaReadThrottle = createLogThrottle(HOUR_MS);

  constructor(
    private readonly schedule: BusScheduleService,
    private readonly estimates: BusEtaRepository,
    private readonly stops: BusStopsService,
    private readonly clock: Clock,
  ) {}

  async getSmart(serviceId: string, lang: SupportedLang): Promise<WithEtag<SmartSchedule>> {
    const serviceConfig = serviceConfigOf(serviceId);
    const resolved = serviceConfig ? await this.schedule.resolveSmartSchedule(serviceId) : null;
    if (!resolved) throw new AppError("SERVICE_NOT_FOUND", `Unknown serviceId: ${serviceId}`, 404);
    // WHY: applied to a copy after the schedule cache and before hashing, so the ETag follows the estimates.
    const etaRouteTypes = serviceConfig?.eta?.routeTypes;
    const result = etaRouteTypes && resolved.status === "active" ? await this.withEstimates(resolved, etaRouteTypes) : resolved;
    const data = withStatusMessage(result, lang);
    const hash = crypto.createHash("md5").update(JSON.stringify(data)).digest("hex");
    const maxAge = etaRouteTypes ? ESTIMATES_MAX_AGE_S : MAX_AGE_S;
    // WHY: private, since the body is in the request's language and a shared cache would serve it to every language.
    return withEtag(data, `"smart-${serviceId}-${data.from || data.status}-${hash}"`, `private, max-age=${maxAge}`);
  }

  // WHY: the schedule as resolved when the estimates or the stops cannot be read.
  private async withEstimates(result: SmartSchedule, routeTypes: readonly string[]): Promise<SmartSchedule> {
    const [estimates, stops] = await Promise.allSettled([this.servedEstimates(), this.stops.current()]);
    if (stops.status === "rejected") {
      this.warnUnestimated(result.serviceId, "bus.eta.stops_unavailable", stops.reason);
      return result;
    }
    try {
      if (estimates.status === "rejected") throw estimates.reason;
      return applyEstimates(result, { routeTypes, sequences: stops.value.catalog.sequences[result.serviceId] ?? {}, estimates: estimates.value });
    } catch (err: unknown) {
      this.warnUnestimated(result.serviceId, "bus.eta.read_failed", err);
      return result;
    }
  }

  private warnUnestimated(serviceId: string, event: "bus.eta.read_failed" | "bus.eta.stops_unavailable", err: unknown): void {
    const ticket = this.etaReadThrottle.take(`${event} ${serviceId}`);
    if (ticket) logger.warn({ event, serviceId, suppressed: ticket.suppressed, err }, "arrival estimates unavailable, serving the stored timetable");
  }

  private async servedEstimates(): Promise<Map<string, ServedEstimate>> {
    return pickEstimates(await this.docs.get(), this.clock.now());
  }
}
