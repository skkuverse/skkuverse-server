import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { createLogThrottle, type LogThrottle } from "../../infra/log-throttle";
import logger from "../../infra/logger";
import type { CountdownDivergence, TrainArrival } from "../estimate/subway-estimate.types";
import { SubwayEstimateService } from "../estimate/subway-estimate.service";
import type { SubwayArrivalsDoc } from "../subway.document";
import { SubwayRepository } from "../subway.repository";
import type { SubwayDirection, SubwayProvider, TrainEvent } from "../subway.types";
import type { StationSchedule } from "../timetable/subway-timetable.types";
import { SubwayTimetableService } from "../timetable/subway-timetable.service";
import { MAX_TRAINS_PER_DIRECTION } from "./subway-tracking.constants";
import { toArrivalsDoc } from "./subway-tracking.mapper";
import { mergeObservations, toDirectionByDestination, toLiveCountdownRows } from "./subway-tracking.rules";
import type { SourceCountdownRows, StationObservations, TrainHistory } from "./subway-tracking.types";

const DIVERGENCE_LOG_INTERVAL_MS = 10 * 60_000;

// WHY: the per-train histories live in memory: one poller process writes subway_arrivals (design D2), and a
// restart rebuilds them from the next ticks (design D8). An upstream is observed only in the service window.
// A train only in countdown rows, absent from the timetable, is not served: every estimate starts from one.
@Injectable()
export class SubwayTrackingService {
  private readonly historiesByStationId = new Map<string, ReadonlyMap<string, TrainHistory>>();
  private readonly countdownRowsBySource = new Map<string, SourceCountdownRows>();
  private readonly divergenceThrottle: LogThrottle;

  constructor(
    private readonly repository: SubwayRepository,
    private readonly timetable: SubwayTimetableService,
    private readonly estimate: SubwayEstimateService,
    private readonly clock: Clock,
  ) {
    this.divergenceThrottle = createLogThrottle(DIVERGENCE_LOG_INTERVAL_MS, () => this.clock.now().getTime());
  }

  async track(provider: SubwayProvider): Promise<void> {
    if (!(await this.timetable.isInServiceWindow(this.clock.now()))) return;
    const observations = await provider.observe();
    const now = this.clock.now();
    this.countdownRowsBySource.set(observations.source, { observedAt: now, rows: observations.countdownRows });
    const countdownRows = toLiveCountdownRows([...this.countdownRowsBySource.values()], now);
    const schedules = await this.timetable.listStationSchedules(now);
    const docs = schedules.map((schedule) =>
      this.toStationDoc(schedule, { histories: this.mergeInto(schedule, observations.events, now), countdownRows }, now),
    );
    await this.repository.upsertArrivals(docs);
  }

  async findScheduledArrivals(stationId: string, now: Date): Promise<SubwayArrivalsDoc | null> {
    const schedule = await this.timetable.findStationSchedule(stationId, now);
    return schedule && this.toStationDoc(schedule, { histories: new Map(), countdownRows: [] }, now);
  }

  private mergeInto(schedule: StationSchedule, events: readonly TrainEvent[], now: Date): ReadonlyMap<string, TrainHistory> {
    const stationId = schedule.station.id;
    const histories = mergeObservations({
      histories: this.historiesByStationId.get(stationId) ?? new Map(),
      responseEvents: [events.filter((event) => schedule.lineRoutes.up.includes(event.stationId))],
      routes: schedule.lineRoutes,
      directionByDestination: toDirectionByDestination(schedule.trains),
      now,
    });
    this.historiesByStationId.set(stationId, histories);
    return histories;
  }

  private toStationDoc(schedule: StationSchedule, observed: StationObservations, now: Date): SubwayArrivalsDoc {
    const stationId = schedule.station.id;
    const { histories, countdownRows } = observed;
    const arrivalsOf = (direction: SubwayDirection): TrainArrival[] => {
      const estimated = this.estimate.estimateArrivals({ stationId, direction, trains: schedule.trains, histories, countdownRows, now });
      this.logDivergences(estimated.divergences);
      return estimated.arrivals.slice(0, MAX_TRAINS_PER_DIRECTION);
    };
    const stamp = { _id: stationId, generatedAt: now, serviceDate: schedule.serviceDate };
    return toArrivalsDoc(stamp, { up: arrivalsOf("up"), down: arrivalsOf("down") });
  }

  // WHY: design D5: the live countdown is still served; the accuracy report later shows which was closer.
  private logDivergences(divergences: readonly CountdownDivergence[]): void {
    for (const divergence of divergences) {
      const ticket = this.divergenceThrottle.take(`${divergence.stationId} ${divergence.trainNo}`);
      if (!ticket) continue;
      logger.info(
        { event: "subway.tracking.countdown_diverged", ...divergence, suppressed: ticket.suppressed },
        "A published countdown is over 120 s from the train's estimate",
      );
    }
  }
}
