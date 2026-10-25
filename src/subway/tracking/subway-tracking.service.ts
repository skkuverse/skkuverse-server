import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import type { LogThrottle } from "../../shared/log-throttle.types";
import { createLogThrottle } from "../../shared/log-throttle.util";
import logger from "../../infra/logger";
import type { CountdownDivergence, CountdownRejection, TrainArrival } from "../estimate/subway-estimate.types";
import { SubwayEstimateService } from "../estimate/subway-estimate.service";
import type { SubwayArrivalsDoc } from "../subway.document";
import { toSubwayLine } from "../subway.rules";
import type { SubwayDirection, SubwayProvider, TrainEvent } from "../subway.types";
import { SubwayStateService } from "../state/subway-state.service";
import type { PlatformSchedule } from "../timetable/subway-timetable.types";
import { SubwayTimetableService } from "../timetable/subway-timetable.service";
import { MAX_TRAINS_PER_DIRECTION } from "./subway-tracking.constants";
import { toArrivalsDoc } from "./subway-tracking.mapper";
import { mergeObservations, toDirectionByDestination, toLiveCountdownRows, toNewestEvents, toPassedPlatformIds, toStopPlatformIdsByTrainNo } from "./subway-tracking.rules";
import type { RunMatcher, SourceCountdownRows, StationObservations, TrackedPlatform, TrackedTickListener, TrainHistory } from "./subway-tracking.types";

const DIVERGENCE_LOG_INTERVAL_MS = 10 * 60_000;

// WHY: the per-train histories live in memory: one poller process writes subway_arrivals (ADR 0012, D1), and a
// restart rebuilds them from the next ticks. A train absent from the timetable is not served, and a
// platform whose table cannot be read is skipped, the tick rejecting after the rest.
@Injectable()
export class SubwayTrackingService {
  private readonly historiesByPlatformId = new Map<string, ReadonlyMap<string, TrainHistory>>();
  private readonly countdownRowsBySource = new Map<string, SourceCountdownRows>();
  private readonly tickListeners: TrackedTickListener[] = [];
  private runMatcher: RunMatcher | null = null;
  private readonly divergenceThrottle: LogThrottle;
  private readonly rejectionThrottle: LogThrottle;

  constructor(
    private readonly state: SubwayStateService,
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
    const { schedules, unavailable } = await this.timetable.listPlatformSchedules(now);
    const lineEvents = this.toRunNumberedEvents(observations.events, schedules, now);
    const platforms = schedules.map((schedule): TrackedPlatform => {
      const events = toNewestEvents(lineEvents.filter((event) => schedule.lineRoutes.up.includes(event.platformId)), now);
      const histories = this.mergeInto(schedule, events, now);
      const arrivals = this.toPlatformDoc(schedule, { histories, countdownRows }, now);
      return { platformId: schedule.platform.id, lineCode: schedule.platform.line, serviceDate: schedule.serviceDate, events, arrivals };
    });
    await this.state.writeArrivals(platforms.map((platform) => platform.arrivals));
    for (const listener of this.tickListeners) await listener({ source: observations.source, trackedAt: now, platforms });
    if (unavailable) throw unavailable;
  }

  // WHY: the accuracy history listens here instead of the tracker calling it, so serving never depends on it;
  // a listener must not reject, or it fails the tick after the arrivals are written.
  addTickListener(listener: TrackedTickListener): void {
    this.tickListeners.push(listener);
  }

  // WHY: the matching flow registers here, as the history listens, so the tracker keeps its four dependencies; a
  // tick on a trainset line with none registered fails rather than serve trainset numbers as trips.
  setRunMatcher(matcher: RunMatcher): void {
    this.runMatcher = matcher;
  }

  async findScheduledArrivals(platformId: string, now: Date): Promise<SubwayArrivalsDoc | null> {
    const schedule = await this.timetable.findPlatformSchedule(platformId, now);
    return schedule && this.toPlatformDoc(schedule, null, now);
  }

  // WHY: a trainset line's upstream numbers trainsets, not trips, so its events reach the histories under the runs
  // they are matched to, and one matching no run is dropped (ADR 0017, D7); every other line's pass as they are.
  private toRunNumberedEvents(events: readonly TrainEvent[], schedules: readonly PlatformSchedule[], now: Date): TrainEvent[] {
    const isTrainsetLine = (schedule: PlatformSchedule): boolean => toSubwayLine(schedule.platform.line).seoul.trainNumbers === "trainset";
    const trainsetSchedules = [...new Map(schedules.filter(isTrainsetLine).map((schedule) => [schedule.platform.line, schedule])).values()];
    if (trainsetSchedules.length === 0) return [...events];
    const matcher = this.runMatcher;
    if (!matcher) throw new Error("subway tracking: no run matcher is registered for a trainset line");
    const isOnTrainsetLine = (event: TrainEvent): boolean => trainsetSchedules.some((schedule) => schedule.lineRoutes.up.includes(event.platformId));
    const runEvents = trainsetSchedules.flatMap((schedule) => matcher(schedule, events, now));
    return [...events.filter((event) => !isOnTrainsetLine(event)), ...runEvents];
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
    const stopPlatformIdsByTrainNo = toStopPlatformIdsByTrainNo(schedule.trains);
    const documentedOf = (direction: SubwayDirection) =>
      arrivalsOf(direction).map((arrival) => ({
        arrival,
        passedPlatformIds: toPassedPlatformIds(schedule.lineRoutes[direction], platformId, stopPlatformIdsByTrainNo.get(arrival.trainNo) ?? []),
      }));
    const stamp = { _id: platformId, generatedAt: now, serviceDate: schedule.serviceDate };
    return toArrivalsDoc(stamp, { up: documentedOf("up"), down: documentedOf("down") });
  }

  // WHY: the live countdown is still served (ADR 0017, D5); the accuracy report later shows which was closer.
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
