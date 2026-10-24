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
import { applyEstimates, toDayRuns, withStatusMessage } from "./bus-eta-smart.mapper";
import { isUnderWayAt, pickEstimates, pickLatestEstimates } from "./bus-eta-smart.rules";
import type { EstimateInputs, RunList, RunWindow } from "./bus-eta-smart.types";

const HOUR_MS = 60 * 60_000;
const MAX_AGE_S = 300;
const NO_ESTIMATES: EstimateInputs = { routeTypes: [], sequences: {}, estimates: new Map() };

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
    const data = await this.resolveSmart(serviceId, lang);
    const hash = crypto.createHash("md5").update(JSON.stringify(data)).digest("hex");
    const maxAge = serviceConfigOf(serviceId)?.eta?.routeTypes ? ESTIMATES_MAX_AGE_S : MAX_AGE_S;
    // WHY: private, since the body is in the request's language and a shared cache would serve it to every language.
    return withEtag(data, `"smart-${serviceId}-${data.from || data.status}-${hash}"`, `private, max-age=${maxAge}`);
  }

  /** SEE: docs/plans/7800-unified-arrivals.md ("7.2 The run read, and how F1 ends"): each run of the shown week, and of the next for weekCount 2, still under way at `from`. */
  async listRuns(serviceId: string, { from, weekCount }: RunWindow): Promise<RunList> {
    const smart = await this.resolveSchedule(serviceId);
    if (smart.status !== "active" || smart.from === null) return { status: smart.status, runs: [] };
    const followingDays = weekCount === 2 ? await this.schedule.resolveFollowingWeek(serviceId, smart.from) : [];
    if (!followingDays) throw new AppError("SERVICE_NOT_FOUND", `Unknown serviceId: ${serviceId}`, 404);
    const routeTypes = serviceConfigOf(serviceId)?.eta?.routeTypes;
    const inputs = (routeTypes && (await this.estimateInputs(serviceId, routeTypes))) ?? NO_ESTIMATES;
    // WHY: a run of the following week keeps its served estimate (ADR 0019, D12).
    const followingInputs = { ...inputs, latestEstimates: undefined };
    const days = [...smart.days.map((day) => ({ day, inputs })), ...followingDays.map((day) => ({ day, inputs: followingInputs }))];
    const runs = days.flatMap(({ day, inputs: dayInputs }) => toDayRuns(serviceId, day, dayInputs).flatMap((run) => (run && isUnderWayAt(run, from) ? [run] : [])));
    return { status: "active", runs };
  }

  private async resolveSchedule(serviceId: string): Promise<SmartSchedule> {
    const resolved = serviceConfigOf(serviceId) ? await this.schedule.resolveSmartSchedule(serviceId) : null;
    if (!resolved) throw new AppError("SERVICE_NOT_FOUND", `Unknown serviceId: ${serviceId}`, 404);
    return resolved;
  }

  // WHY: runs, then the timetable's "HH:mm", applied to a copy after the schedule cache and before hashing, so the
  // ETag follows the estimates.
  private async resolveSmart(serviceId: string, lang: SupportedLang): Promise<SmartSchedule> {
    const resolved = await this.resolveSchedule(serviceId);
    const routeTypes = serviceConfigOf(serviceId)?.eta?.routeTypes;
    const inputs = routeTypes && resolved.status === "active" ? await this.estimateInputs(serviceId, routeTypes) : null;
    return withStatusMessage(inputs ? this.withEstimates(resolved, inputs) : resolved, lang);
  }

  private withEstimates(result: SmartSchedule, inputs: EstimateInputs): SmartSchedule {
    try {
      return applyEstimates(result, inputs);
    } catch (err: unknown) {
      this.warnUnestimated(result.serviceId, "bus.eta.read_failed", err);
      return result;
    }
  }

  // WHY: null, logged, when the estimates or the stops cannot be read, so the stored timetable serves.
  private async estimateInputs(serviceId: string, routeTypes: readonly string[]): Promise<EstimateInputs | null> {
    const [docs, stops] = await Promise.allSettled([this.docs.get(), this.stops.current()]);
    if (stops.status === "rejected") {
      this.warnUnestimated(serviceId, "bus.eta.stops_unavailable", stops.reason);
      return null;
    }
    if (docs.status === "rejected") {
      this.warnUnestimated(serviceId, "bus.eta.read_failed", docs.reason);
      return null;
    }
    const now = this.clock.now();
    const sequences = stops.value.catalog.sequences[serviceId] ?? {};
    return { routeTypes, sequences, estimates: pickEstimates(docs.value, now), latestEstimates: pickLatestEstimates(docs.value, now) };
  }

  private warnUnestimated(serviceId: string, event: "bus.eta.read_failed" | "bus.eta.stops_unavailable", err: unknown): void {
    const ticket = this.etaReadThrottle.take(`${event} ${serviceId}`);
    if (ticket) logger.warn({ event, serviceId, suppressed: ticket.suppressed, err }, "arrival estimates unavailable, serving the stored timetable");
  }
}
