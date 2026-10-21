import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { t } from "../../infra/i18n";
import { createLogThrottle } from "../../infra/log-throttle";
import logger from "../../infra/logger";
import type { SupportedLang } from "../../infra/types";
import { BusEtaSmartService } from "../eta/smart/bus-eta-smart.service";
import { BusRealtimeGroupService } from "../realtime/group/bus-realtime-group.service";
import type { GroupView } from "../realtime/group/bus-realtime-group.types";
import type { SmartSchedule } from "../schedule/bus-schedule.wire";
import { BusStopIndexService } from "../stop-index/bus-stop-index.service";
import type { HsscStopRoute, JongroStopRoute, ShuttleStopRoute, StopRoute } from "../stop-index/bus-stop-index.types";
import { LEFT_OUT_LOG_INTERVAL_MS } from "./bus-stop-arrivals.constants";
import { toHsscEntry, toJongroEntry, toShuttleEntry, toStopBlock } from "./bus-stop-arrivals.mapper";
import { toApproaching, toNextRuns } from "./bus-stop-arrivals.rules";
import type { StopArrivalsRoute } from "./bus-stop-arrivals.types";
import type { BusStopArrivals } from "./bus-stop-arrivals.wire";

/** WHY: what one page reads, each group's view and each service's schedule once, however many entries share it. */
interface PageReads {
  lang: SupportedLang;
  now: Date;
  views: Map<string, Promise<GroupView>>;
  schedules: Map<string, Promise<SmartSchedule>>;
}

// SEE: docs/reference/bus-stops-api.md: built from stored data only, through the realtime and smart views' own caches.
@Injectable()
export class BusStopArrivalsService {
  private readonly leftOutThrottle = createLogThrottle(LEFT_OUT_LOG_INTERVAL_MS, () => this.clock.now().getTime());

  constructor(
    private readonly index: BusStopIndexService,
    private readonly realtime: BusRealtimeGroupService,
    private readonly smart: BusEtaSmartService,
    private readonly clock: Clock,
  ) {}

  async findStopArrivals(stopId: string, lang: SupportedLang): Promise<BusStopArrivals | null> {
    const stop = await this.index.findStop(stopId);
    if (!stop) return null;
    const reads: PageReads = { lang, now: this.clock.now(), views: new Map(), schedules: new Map() };
    const entries = await Promise.all(stop.routes.map((route) => this.toEntry(route, reads).catch((err: unknown) => this.leaveOut(stop.id, route, err))));
    return { stop: toStopBlock(stop, this.index.servedRecordOf(stop, lang)), routes: entries.flatMap((entry) => (entry ? [entry] : [])) };
  }

  private toEntry(route: StopRoute, reads: PageReads): Promise<StopArrivalsRoute | null> {
    if (route.kind === "jongro") return this.toJongroEntry(route, reads);
    if (route.kind === "hssc") return this.toHsscEntry(route, reads);
    return this.toShuttleEntry(route, reads);
  }

  // WHY: the index and the view read the registry apart, so a sync between them would place another station's
  // arrivals at this index; that poll leaves the entry out, and the next one serves it.
  private async toJongroEntry(route: JongroStopRoute, reads: PageReads): Promise<StopArrivalsRoute | null> {
    const view = await this.viewOf(route.groupId, reads);
    if (view.stationsVersion !== route.stationsVersion) return null;
    return toJongroEntry(route, view, t(`busconfig.label.${route.groupId}`, reads.lang));
  }

  private async toHsscEntry(route: HsscStopRoute, reads: PageReads): Promise<StopArrivalsRoute> {
    const { buses } = await this.viewOf(route.groupId, reads);
    return toHsscEntry(route, t(`busconfig.label.${route.groupId}`, reads.lang), toApproaching(buses, route.stationIndex));
  }

  private async toShuttleEntry(route: ShuttleStopRoute, reads: PageReads): Promise<StopArrivalsRoute> {
    const schedule = await this.readOnce(reads.schedules, route.serviceId, () => this.smart.resolveSmart(route.serviceId, reads.lang));
    return toShuttleEntry(route, t(`busconfig.service.${route.serviceId}`, reads.lang), { status: schedule.status, next: toNextRuns(schedule, route, reads.now) });
  }

  private viewOf(groupId: string, reads: PageReads): Promise<GroupView> {
    return this.readOnce(reads.views, groupId, async () => {
      const view = await this.realtime.findGroupView(groupId);
      if (!view) throw new Error(`bus: the stop index names ${groupId}, which the realtime view does not serve`);
      return view;
    });
  }

  private readOnce<T>(reads: Map<string, Promise<T>>, key: string, read: () => Promise<T>): Promise<T> {
    const pending = reads.get(key) ?? read();
    reads.set(key, pending);
    return pending;
  }

  // WHY: one route that cannot be read (its attributes, registry or timetable unavailable) leaves the rest of the page served (D17).
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
