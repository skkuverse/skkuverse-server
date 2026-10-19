import { Injectable } from "@nestjs/common";
import crypto from "crypto";
import moment from "moment-timezone";
import { AppError } from "../../http/app.error";
import { withEtag } from "../../http/etag.interceptor";
import type { WithEtag } from "../../http/response.types";
import { createCachedLoader, type CachedLoader } from "../../infra/cached-loader";
import { Clock } from "../../infra/clock";
import logger from "../../infra/logger";
import { createLogThrottle } from "../../infra/log-throttle";
import { HolidaysService } from "../../holidays/holidays.service";
import { KST_TIME_ZONE } from "../../shared/time-zone.constants";
import { serviceConfigOf } from "../bus.rules";
import type { ServiceConfigEntry } from "../bus.types";
import { SKKU_REST_DAYS } from "./bus-schedule.config";
import { BusScheduleRepository } from "./bus-schedule.repository";
import { firstSelectableDate, isWeekStartInRange, pickPattern, toDay, toNonOperatingDayLabel, toSuspendWindow } from "./bus-schedule.rules";
import type { ScheduleDay, ScheduleWeek, SmartSchedule } from "./bus-schedule.wire";

const DATE_FORMAT = "YYYY-MM-DD";
const HOUR_MS = 60 * 60_000;
// SEE: docs/explanation/bus-architecture.md ("Invariants")
const WEEK_CACHE_TTL_MS = 60_000;
const WEEK_STALE_WINDOW_MS = HOUR_MS;

@Injectable()
export class BusScheduleService {
  private readonly weeks = new Map<string, CachedLoader<ScheduleWeek>>();
  // WHY: each is evaluated per request; once an hour per service is enough to see them.
  private readonly weekCallThrottle = createLogThrottle(HOUR_MS);
  private readonly invalidSuspendThrottle = createLogThrottle(HOUR_MS);
  private readonly noDataThrottle = createLogThrottle(HOUR_MS);
  private readonly patternConflictThrottle = createLogThrottle(HOUR_MS);

  constructor(
    private readonly repository: BusScheduleRepository,
    private readonly holidays: HolidaysService,
    private readonly clock: Clock,
  ) {}

  // WHY: old app builds still call the deprecated week view; an hourly line per service counts them.
  async getWeek(serviceId: string, from: string | undefined): Promise<WithEtag<ScheduleWeek>> {
    const ticket = this.weekCallThrottle.take(serviceId);
    if (ticket) {
      logger.warn({ event: "bus.schedule.week_endpoint_called", serviceId, suppressed: ticket.suppressed }, "deprecated: /week endpoint called, use /smart");
    }
    if (from !== undefined && !isWeekStartInRange(from, this.clock.now())) {
      throw new AppError("INVALID_DATE_FORMAT", "from must be a date within a year of today", 400);
    }
    const week = await this.resolveWeek(serviceId, from);
    if (!week) throw new AppError("SERVICE_NOT_FOUND", `Unknown serviceId: ${serviceId}`, 404);
    const hash = crypto.createHash("md5").update(JSON.stringify(week)).digest("hex");
    return withEtag(week, `"week-${serviceId}-${week.from}-${hash}"`);
  }

  async resolveWeek(serviceId: string, fromDate?: string): Promise<ScheduleWeek | null> {
    const serviceConfig = serviceConfigOf(serviceId);
    if (!serviceConfig) return null;
    const ref = fromDate ? moment.tz(fromDate, DATE_FORMAT, KST_TIME_ZONE) : moment(this.clock.now()).tz(KST_TIME_ZONE);
    const from = ref.clone().isoWeekday(1).startOf("day").format(DATE_FORMAT);
    const week = await this.weekLoader(serviceId, from, serviceConfig).get();
    return { ...week, requestedFrom: fromDate || null };
  }

  async resolveSmartSchedule(serviceId: string): Promise<SmartSchedule | null> {
    const serviceConfig = serviceConfigOf(serviceId);
    if (!serviceConfig) return null;
    const today = moment(this.clock.now()).tz(KST_TIME_ZONE);
    const suspended = this.suspendedResult(serviceId, serviceConfig, today);
    if (suspended) return suspended;

    const thisMonday = today.clone().isoWeekday(1).startOf("day");
    const thisWeek = await this.weekLoader(serviceId, thisMonday.format(DATE_FORMAT), serviceConfig).get();
    let selectedDate = firstSelectableDate(thisWeek.days, today.isoWeekday() - 1);
    let shown = thisWeek;
    if (!selectedDate) {
      shown = await this.weekLoader(serviceId, thisMonday.clone().add(1, "week").format(DATE_FORMAT), serviceConfig).get();
      selectedDate = firstSelectableDate(shown.days, 0);
    }
    if (!selectedDate) return this.noDataResult(serviceId);
    const days = shown.days.filter((d) => d.display !== "hidden");
    return { serviceId, status: "active", from: shown.from, selectedDate, days };
  }

  private suspendedResult(serviceId: string, serviceConfig: ServiceConfigEntry, today: moment.Moment): SmartSchedule | null {
    const window = toSuspendWindow(serviceConfig.suspend, today);
    if (window?.invalid) {
      const ticket = this.invalidSuspendThrottle.take(`${serviceId} ${JSON.stringify(serviceConfig.suspend)}`);
      if (ticket) {
        logger.warn(
          { event: "bus.schedule.suspend_config_invalid", serviceId, suspend: serviceConfig.suspend, suppressed: ticket.suppressed },
          "invalid suspend config, ignoring",
        );
      }
      return null;
    }
    if (!window?.resumeDate) return null;
    return { serviceId, status: "suspended", resumeDate: window.resumeDate, from: null, selectedDate: null, days: [] };
  }

  private noDataResult(serviceId: string): SmartSchedule {
    const ticket = this.noDataThrottle.take(serviceId);
    if (ticket) {
      logger.warn({ event: "bus.schedule.no_data", serviceId, suppressed: ticket.suppressed }, "no schedule data found within 2 weeks (noData)");
    }
    return { serviceId, status: "noData", from: null, selectedDate: null, days: [] };
  }

  // WHY: CACHE=off (the development default) reads the database every time, so `npm run schedule` shows at once.
  private weekLoader(serviceId: string, from: string, serviceConfig: ServiceConfigEntry): CachedLoader<ScheduleWeek> {
    const key = `${serviceId}:${from}`;
    let loader = this.weeks.get(key);
    if (!loader) {
      loader = createCachedLoader({
        name: `bus.schedule.${key}`,
        ttlMs: WEEK_CACHE_TTL_MS,
        staleWindowMs: WEEK_STALE_WINDOW_MS,
        serveStale: "on-reload-failure",
        load: () => this.loadWeek(serviceId, from, serviceConfig),
      });
      this.weeks.set(key, loader);
    }
    return loader;
  }

  private async loadWeek(serviceId: string, from: string, serviceConfig: ServiceConfigEntry): Promise<ScheduleWeek> {
    const monday = moment.tz(from, DATE_FORMAT, KST_TIME_ZONE);
    const [overrides, patterns] = await Promise.all([
      this.repository.listOverrides(serviceId, from, monday.clone().add(6, "days").format(DATE_FORMAT)),
      this.repository.listPatterns(serviceId),
    ]);
    const overrideByDate = new Map(overrides.map((o) => [o.date, o]));
    const serviceNotices = serviceConfig.notices.map((n) => ({ ...n, source: "service" }));
    const days: ScheduleDay[] = [];
    for (let i = 0; i < 7; i++) {
      const date = monday.clone().add(i, "days");
      const dateStr = date.format(DATE_FORMAT);
      const override = overrideByDate.get(dateStr);
      const restDayLabel =
        !override && serviceConfig.respectsKoreanHolidays
          ? toNonOperatingDayLabel(SKKU_REST_DAYS, dateStr, await this.holidays.holidayName(dateStr))
          : null;
      const pattern = override || restDayLabel ? undefined : this.patternOn(serviceId, patterns, date);
      days.push(toDay(date, { override, restDayLabel, pattern, serviceNotices, config: serviceConfig }));
    }
    return { serviceId, requestedFrom: null, from, days };
  }

  private patternOn(serviceId: string, patterns: Parameters<typeof pickPattern>[0], date: moment.Moment) {
    const dateStr = date.format(DATE_FORMAT);
    const { pattern, conflicting } = pickPattern(patterns, dateStr, date.isoWeekday());
    const ticket = conflicting ? this.patternConflictThrottle.take(serviceId) : null;
    if (conflicting && ticket) {
      logger.error(
        {
          event: "bus.schedule.pattern_conflict",
          serviceId,
          date: dateStr,
          patternIds: conflicting.map((p) => p.patternId),
          served: conflicting[0]?.patternId,
          suppressed: ticket.suppressed,
        },
        "several schedule patterns apply to one date",
      );
    }
    return pattern;
  }
}
