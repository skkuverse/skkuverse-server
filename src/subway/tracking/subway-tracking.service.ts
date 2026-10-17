import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { createLogThrottle, type LogThrottle } from "../../infra/log-throttle";
import logger from "../../infra/logger";
import type { CountdownDivergence, CountdownRejection, TrainArrival } from "../estimate/subway-estimate.types";
import { SubwayEstimateService } from "../estimate/subway-estimate.service";
import type { SubwayArrivalsDoc } from "../subway.document";
import { SubwayRepository } from "../subway.repository";
import type { SubwayDirection, SubwayProvider, TrainEvent } from "../subway.types";
import type { PlatformSchedule } from "../timetable/subway-timetable.types";
import { SubwayTimetableService } from "../timetable/subway-timetable.service";
import { MAX_TRAINS_PER_DIRECTION } from "./subway-tracking.constants";
import { toArrivalsDoc } from "./subway-tracking.mapper";
import { mergeObservations, toDirectionByDestination, toLiveCountdownRows, toNewestEvents, toStopPlatformIdsByTrainNo } from "./subway-tracking.rules";
import type { SourceCountdownRows, StationObservations, TrackedPlatform, TrackedTickListener, TrainHistory } from "./subway-tracking.types";

const DIVERGENCE_LOG_INTERVAL_MS = 10 * 60_000;

// WHY: the per-train histories live in memory: one poller process writes subway_arrivals (design D2), and a
// restart rebuilds them from the next ticks (design D8). An upstream is observed only in the service window.
// A train only in countdown rows, absent from the timetable, is not served: every estimate starts from one.
@Injectable()
export class SubwayTrackingService {
  private readonly historiesByPlatformId = new Map<string, ReadonlyMap<string, TrainHistory>>();
  private readonly countdownRowsBySource = new Map<string, SourceCountdownRows>();
  private readonly tickListeners: TrackedTickListener[] = [];
  private readonly divergenceThrottle: LogThrottle;
  private readonly rejectionThrottle: LogThrottle;

  constructor(
    private readonly repository: SubwayRepository,
    private readonly timetable: SubwayTimetableService,
    private readonly estimate: SubwayEstimateService,
    private readonly clock: Clock,
  ) {
    this.divergenceThrottle = createLogThrottle(DIVERGENCE_LOG_INTERVAL_MS, () => this.clock.now().getTime());
    this.rejectionThrottle = createLogThrottle(DIVERGENCE_LOG_INTERVAL_MS, () => this.clock.now().getTime());
  }

  async track(provider: SubwayProvider): Promise<void> {
    if (!(await this.timetable.isInServiceWindow(this.clock.now()))) return;
    const observations = await provider.observe();
    const now = this.clock.now();
    this.countdownRowsBySource.set(observations.source, { observedAt: now, rows: observations.countdownRows });
    const countdownRows = toLiveCountdownRows([...this.countdownRowsBySource.values()], now);
    const schedules = await this.timetable.listPlatformSchedules(now);
    const platforms = schedules.map((schedule): TrackedPlatform => {
      const events = toNewestEvents(observations.events.filter((event) => schedule.lineRoutes.up.includes(event.platformId)), now);
      const histories = this.mergeInto(schedule, events, now);
      const arrivals = this.toPlatformDoc(schedule, { histories, countdownRows }, now);
      return { platformId: schedule.platform.id, lineCode: schedule.platform.line, serviceDate: schedule.serviceDate, events, arrivals };
    });
    await this.repository.upsertArrivals(platforms.map((platform) => platform.arrivals));
    for (const listener of this.tickListeners) await listener({ source: observations.source, trackedAt: now, platforms });
  }

  // WHY: the accuracy history listens here instead of the tracker calling it, so serving never depends on it;
  // a listener must not reject, or it fails the tick after the arrivals are written.
  addTickListener(listener: TrackedTickListener): void {
    this.tickListeners.push(listener);
  }

  async findScheduledArrivals(platformId: string, now: Date): Promise<SubwayArrivalsDoc | null> {
    const schedule = await this.timetable.findPlatformSchedule(platformId, now);
    return schedule && this.toPlatformDoc(schedule, null, now);
  }

  private mergeInto(schedule: PlatformSchedule, events: readonly TrainEvent[], now: Date): ReadonlyMap<string, TrainHistory> {
    const platformId = schedule.platform.id;
    const histories = mergeObservations({
      histories: this.historiesByPlatformId.get(platformId) ?? new Map(),
      responseEvents: [events],
      routes: schedule.lineRoutes,
      directionByDestination: toDirectionByDestination(schedule.trains),
      platformId,
      stopPlatformIdsByTrainNo: toStopPlatformIdsByTrainNo(schedule.trains),
      now,
    });
    this.historiesByPlatformId.set(platformId, histories);
    return histories;
  }

  private toPlatformDoc(schedule: PlatformSchedule, observed: StationObservations | null, now: Date): SubwayArrivalsDoc {
    const platformId = schedule.platform.id;
    const arrivalsOf = (direction: SubwayDirection): TrainArrival[] => {
      const scheduleInput = { platformId, direction, trains: schedule.trains, now };
      if (!observed) return this.estimate.listScheduledArrivals(scheduleInput).slice(0, MAX_TRAINS_PER_DIRECTION);
      const estimated = this.estimate.estimateArrivals({ ...scheduleInput, ...observed });
      this.logDivergences(estimated.divergences);
      this.logRejections(estimated.rejections);
      return estimated.arrivals.slice(0, MAX_TRAINS_PER_DIRECTION);
    };
    const stamp = { _id: platformId, generatedAt: now, serviceDate: schedule.serviceDate };
    return toArrivalsDoc(stamp, { up: arrivalsOf("up"), down: arrivalsOf("down") });
  }

  // WHY: design D5: the live countdown is still served; the accuracy report later shows which was closer.
  private logDivergences(divergences: readonly CountdownDivergence[]): void {
    for (const divergence of divergences) {
      const ticket = this.divergenceThrottle.take(`${divergence.platformId} ${divergence.trainNo}`);
      if (!ticket) continue;
      logger.info(
        { event: "subway.tracking.countdown_diverged", ...divergence, suppressed: ticket.suppressed },
        "A published countdown is over 120 s from the train's estimate",
      );
    }
  }

  // WHY: a countdown that is not served leaves no divergence line, and those lines are how a misleading one was found.
  private logRejections(rejections: readonly CountdownRejection[]): void {
    for (const rejection of rejections) {
      const ticket = this.rejectionThrottle.take(`${rejection.platformId} ${rejection.trainNo}`);
      if (!ticket) continue;
      logger.info({ event: "subway.tracking.countdown_rejected", ...rejection, suppressed: ticket.suppressed }, "A published countdown is not served");
    }
  }
}
