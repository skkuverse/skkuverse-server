import { Injectable } from "@nestjs/common";
import { withMeta } from "../../http/response.interceptor";
import type { WithMeta } from "../../http/response.types";
import { Clock } from "../../infra/clock";
import { t } from "../../infra/i18n";
import { createLogThrottle } from "../../infra/log-throttle";
import logger from "../../infra/logger";
import type { SupportedLang } from "../../infra/types";
import { toCatalogNamedLine } from "../bus.mapper";
import { toKstInstant } from "../../shared/kst-date.util";
import { toStationAction, toTowards } from "../bus.rules";
import { BusEtaSmartService } from "../eta/smart/bus-eta-smart.service";
import { BusLiveGroupService } from "../live/group/bus-live-group.service";
import type { LiveGroup } from "../live/bus-live.wire";
import type { SmartSchedule } from "../schedule/bus-schedule.wire";
import type { HsscLineStation } from "../stops/bus-stops.document";
import type { ScheduleStop } from "../stops/bus-stops.types";
import { BusStopIndexService } from "../stop-index/bus-stop-index.service";
import type { HsscStopRoute, JongroStopRoute, ShuttleStopRoute, StopRoute } from "../stop-index/bus-stop-index.types";
import { LEFT_OUT_LOG_INTERVAL_MS, NEXT_RUN_COUNT, OPERATION_BY_SCHEDULE_STATUS } from "./bus-stop-arrivals.constants";
import { toLiveEntry, toStopBlock, toTimetableEntry } from "./bus-stop-arrivals.mapper";
import { toTimetableArrivals } from "./bus-stop-arrivals.rules";
import type { StopArrivalsRoute, TimetableArrival } from "./bus-stop-arrivals.types";
import type { BusStopArrivals, BusStopArrivalsMeta } from "./bus-stop-arrivals.wire";

/** WHY: what one page reads, each group's live answer and each service's schedule once, however many entries share it. */
interface PageReads {
  lang: SupportedLang;
  now: Date;
  hsscLine: readonly HsscLineStation[];
  catalogStops: readonly ScheduleStop[];
  groups: Map<string, Promise<LiveGroup>>;
  schedules: Map<string, Promise<SmartSchedule>>;
  latestSchedules: Map<string, Promise<SmartSchedule>>;
  followingWeeks: Map<string, Promise<SmartSchedule["days"]>>;
}

// SEE: docs/reference/bus-stops-api.md: built from stored data only, through the live route's and smart view's own caches.
@Injectable()
export class BusStopArrivalsService {
  private readonly leftOutThrottle = createLogThrottle(LEFT_OUT_LOG_INTERVAL_MS, () => this.clock.now().getTime());

  constructor(
    private readonly index: BusStopIndexService,
    private readonly live: BusLiveGroupService,
    private readonly smart: BusEtaSmartService,
    private readonly clock: Clock,
  ) {}

  async findStopArrivals(stopId: string, lang: SupportedLang): Promise<WithMeta<BusStopArrivals, BusStopArrivalsMeta> | null> {
    const stop = await this.index.findStop(stopId);
    if (!stop) return null;
    const now = this.clock.now();
    const reads: PageReads = { lang, now, hsscLine: stop.snapshot.hssc, catalogStops: stop.snapshot.catalog.stops, groups: new Map(), schedules: new Map(), latestSchedules: new Map(), followingWeeks: new Map() };
    const entries = await Promise.all(stop.routes.map((route) => this.toEntry(route, reads).catch((err: unknown) => this.leaveOut(stop.id, route, err))));
    const page = { stop: toStopBlock(stop, this.index.servedRecordOf(stop, lang)), routes: entries.flatMap((entry) => (entry ? [entry] : [])) };
    return withMeta(page, { serverNow: toKstInstant(now.getTime()) });
  }

  private toEntry(route: StopRoute, reads: PageReads): Promise<StopArrivalsRoute | null> {
    if (route.kind === "jongro") return this.toJongroEntry(route, reads);
    if (route.kind === "hssc") return this.toHsscEntry(route, reads);
    return this.toShuttleEntry(route, reads);
  }

  // WHY: the index and the live route read the registry apart, so a sync between them would place another station's
  // arrivals at this index; that poll leaves the entry out, and the next one serves it.
  private async toJongroEntry(route: JongroStopRoute, reads: PageReads): Promise<StopArrivalsRoute | null> {
    const [group, direction] = await Promise.all([this.groupOf(route.groupId, reads), this.live.findStationDirection(route.groupId, route, reads.lang)]);
    if (group.stationsVersion !== route.stationsVersion) return null;
    return toLiveEntry(route, group, { label: t(`busconfig.label.${route.groupId}`, reads.lang), towards: route.towards, direction, action: "board" });
  }

  private async toHsscEntry(route: HsscStopRoute, reads: PageReads): Promise<StopArrivalsRoute> {
    const [group, direction] = await Promise.all([this.groupOf(route.groupId, reads), this.live.findStationDirection(route.groupId, { stationIndex: route.stationIndex, stationsVersion: null }, reads.lang)]);
    const towards = toTowards(toCatalogNamedLine(reads.hsscLine, reads.catalogStops, reads.lang), route.stationIndex);
    const action = toStationAction(reads.hsscLine[route.stationIndex]);
    return toLiveEntry(route, group, { label: t(`busconfig.label.${route.groupId}`, reads.lang), towards, direction, action });
  }

  private async toShuttleEntry(route: ShuttleStopRoute, reads: PageReads): Promise<StopArrivalsRoute> {
    const schedule = await this.readOnce(reads.schedules, route.serviceId, () => this.smart.resolveSmart(route.serviceId, reads.lang));
    const arrivals = await this.nextRunsOf(schedule, route, reads);
    return toTimetableEntry(route, t(`busconfig.service.${route.serviceId}`, reads.lang), { operation: OPERATION_BY_SCHEDULE_STATUS[schedule.status], arrivals });
  }

  // WHY: after a week's last run (a Friday evening) the shown week holds none, so the page reads on into the next, whose
  // runs, tomorrow's at the earliest, keep their served estimates: a live value exists only from an hour before departure.
  private async nextRunsOf(schedule: SmartSchedule, route: ShuttleStopRoute, reads: PageReads): Promise<TimetableArrival[]> {
    const latest = await this.readOnce(reads.latestSchedules, route.serviceId, () => this.smart.resolveLatestEstimates(schedule));
    const next = toTimetableArrivals({ served: schedule, latest }, route, reads.now);
    if (next.length >= NEXT_RUN_COUNT || schedule.status !== "active") return next;
    const followingDays = await this.readOnce(reads.followingWeeks, route.serviceId, () => this.smart.resolveFollowingWeek(schedule));
    return toTimetableArrivals({ served: { ...schedule, days: [...schedule.days, ...followingDays] }, latest }, route, reads.now);
  }

  private groupOf(groupId: string, reads: PageReads): Promise<LiveGroup> {
    return this.readOnce(reads.groups, groupId, () => this.live.findLiveGroup(groupId));
  }

  private readOnce<T>(reads: Map<string, Promise<T>>, key: string, read: () => Promise<T>): Promise<T> {
    const pending = reads.get(key) ?? read();
    reads.set(key, pending);
    return pending;
  }

  // WHY: one route that cannot be read (its attributes, registry or timetable unavailable) leaves the rest of the page served.
  private leaveOut(stopId: string, route: StopRoute, err: unknown): null {
    const serviceId = route.kind === "shuttle" ? route.serviceId : undefined;
    const ticket = this.leftOutThrottle.take(serviceId ?? route.groupId);
    if (ticket) {
      logger.error(
        { event: "bus.stop_arrivals.route_left_out", stopId, groupId: route.groupId, ...(serviceId && { serviceId }), suppressed: ticket.suppressed, err },
        "A route of a stop page could not be read; left out of the page",
      );
    }
    return null;
  }
}
