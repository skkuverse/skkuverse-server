import { Injectable, type OnModuleInit } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { createLogThrottle, type LogThrottle } from "../../infra/log-throttle";
import logger from "../../infra/logger";
import type { SubwayDirection } from "../subway.types";
import type { TrackedStation, TrackedTick } from "../tracking/subway-tracking.types";
import { SubwayTrackingService } from "../tracking/subway-tracking.service";
import { UNRESOLVED_SWEEP_INTERVAL_MS, WRITE_FAILURE_LOG_INTERVAL_MS } from "./subway-history.constants";
import type { SubwayEventDoc, SubwayPredictionDoc } from "./subway-history.document";
import { SubwayHistoryRepository } from "./subway-history.repository";
import { toCrossedHorizons, toObservedArrivalAt, toPredictionDoc, toUnresolvedCutoff } from "./subway-history.rules";
import type { AccuracyGroup, AccuracyRange, ObservedArrival } from "./subway-history.types";

const DIRECTIONS: readonly SubwayDirection[] = ["up", "down"];
const WRITE_FAILURE_KEY = "subway.history";

// WHY: written only where the tracker ticks, the poller process (design D2). What was recorded lives in memory for
// one service date, so a restart only skips the horizons crossed before it. A failed write is logged, never thrown:
// it must not fail the tick that already wrote the served arrivals.
@Injectable()
export class SubwayHistoryService implements OnModuleInit {
  private serviceDate: string | null = null;
  private readonly recordedEventKeys = new Set<string>();
  private readonly leadMsByTrain = new Map<string, number>();
  private readonly observedArrivalsByTrain = new Map<string, ObservedArrival>();
  private unresolvedSweptAtMs = Number.NEGATIVE_INFINITY;
  private readonly writeFailureThrottle: LogThrottle;

  constructor(
    private readonly repository: SubwayHistoryRepository,
    private readonly tracking: SubwayTrackingService,
    private readonly clock: Clock,
  ) {
    this.writeFailureThrottle = createLogThrottle(WRITE_FAILURE_LOG_INTERVAL_MS, () => this.clock.now().getTime());
  }

  onModuleInit(): void {
    this.tracking.addTickListener((tick) => this.recordTick(tick));
  }

  private async recordTick(tick: TrackedTick): Promise<void> {
    this.startServiceDate(tick);
    const events = tick.stations.flatMap((station) => this.toNewEvents(tick.source, station));
    const arrivals = tick.stations.flatMap((station) => this.toNewObservedArrivals(station));
    const predictions = tick.stations.flatMap((station) => this.toCrossedPredictions(station, tick.trackedAt));
    await this.write("events", () => this.repository.insertEvents(events));
    await this.write("predictions", () => this.repository.upsertPredictions(predictions));
    for (const arrival of arrivals) await this.write("arrivals", () => this.repository.updateObservedArrival(arrival, tick.trackedAt));
    await this.sweepUnresolved(tick.trackedAt);
  }

  listAccuracyGroups(range: AccuracyRange): Promise<AccuracyGroup[]> {
    return this.repository.listAccuracyGroups(range);
  }

  private startServiceDate(tick: TrackedTick): void {
    const serviceDate = tick.stations[0]?.serviceDate ?? this.serviceDate;
    if (serviceDate === this.serviceDate) return;
    this.serviceDate = serviceDate;
    this.recordedEventKeys.clear();
    this.leadMsByTrain.clear();
    this.observedArrivalsByTrain.clear();
  }

  private toNewEvents(source: string, station: TrackedStation): SubwayEventDoc[] {
    return station.events.flatMap((event) => {
      const key = `${source} ${event.trainNo} ${event.stationId} ${event.state}`;
      if (this.recordedEventKeys.has(key)) return [];
      this.recordedEventKeys.add(key);
      const meta = { line: station.lineCode, trainNo: event.trainNo };
      return [{ at: event.stateChangedAt, meta, stationId: event.stationId, state: event.state, source }];
    });
  }

  private toNewObservedArrivals(station: TrackedStation): ObservedArrival[] {
    return station.events.flatMap((event) => {
      const observedAt = event.stationId === station.stationId ? toObservedArrivalAt(event) : null;
      const key = `${station.stationId} ${event.trainNo}`;
      if (!observedAt || this.observedArrivalsByTrain.has(key)) return [];
      const arrival = { serviceDate: station.serviceDate, trainNo: event.trainNo, stationId: station.stationId, observedAt, observedState: event.state };
      this.observedArrivalsByTrain.set(key, arrival);
      return [arrival];
    });
  }

  private toCrossedPredictions(station: TrackedStation, madeAt: Date): SubwayPredictionDoc[] {
    const { serviceDate, stationId } = station;
    return DIRECTIONS.flatMap((direction) =>
      station.arrivals.directions[direction].flatMap((train) => {
        const key = `${stationId} ${train.trainNo}`;
        const leadMs = train.arrivalAt.getTime() - madeAt.getTime();
        const horizons = toCrossedHorizons(this.leadMsByTrain.get(key), leadMs);
        this.leadMsByTrain.set(key, leadMs);
        const observed = this.observedArrivalsByTrain.get(key);
        return horizons.map((horizonMin) => toPredictionDoc({ serviceDate, stationId, direction, horizonMin, train, madeAt }, observed));
      }),
    );
  }

  private async sweepUnresolved(now: Date): Promise<void> {
    if (now.getTime() - this.unresolvedSweptAtMs < UNRESOLVED_SWEEP_INTERVAL_MS) return;
    this.unresolvedSweptAtMs = now.getTime();
    await this.write("unresolved", () => this.repository.updateUnresolvedPredictions(toUnresolvedCutoff(now), now));
  }

  private async write(records: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (err) {
      const ticket = this.writeFailureThrottle.take(WRITE_FAILURE_KEY);
      if (!ticket) return;
      logger.warn(
        { event: "subway.history.write_failed", records, err, suppressed: ticket.suppressed },
        "Subway accuracy history write failed; the served arrivals are unaffected",
      );
    }
  }
}
