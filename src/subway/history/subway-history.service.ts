import { Injectable, type OnModuleInit } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import type { LogThrottle } from "../../shared/log-throttle.types";
import { createLogThrottle } from "../../shared/log-throttle.util";
import logger from "../../infra/logger";
import type { SubwayDirection } from "../subway.types";
import type { TrackedPlatform, TrackedTick } from "../tracking/subway-tracking.types";
import { SubwayTrackingService } from "../tracking/subway-tracking.service";
import { UNRESOLVED_SWEEP_INTERVAL_MS, WRITE_FAILURE_LOG_INTERVAL_MS } from "./subway-history.constants";
import type { SubwayEventDoc, SubwayPredictionDoc } from "./subway-history.document";
import { SubwayHistoryRepository } from "./subway-history.repository";
import { toCrossedHorizons, toObservedArrivalAt, toPredictionDoc, toUnresolvedCutoff } from "./subway-history.rules";
import type { AccuracyGroup, AccuracyRange, ObservedArrival } from "./subway-history.types";

const DIRECTIONS: readonly SubwayDirection[] = ["up", "down"];
const WRITE_FAILURE_KEY = "subway.history";

// WHY: written only where the tracker ticks, the poller process (ADR 0012, D1). What was recorded lives in memory for
// one service date, so a restart only skips the horizons crossed before it. A failed write is logged, never thrown:
// it must not fail the tick that already wrote the served arrivals.
@Injectable()
export class SubwayHistoryService implements OnModuleInit {
  private serviceDate: string | null = null;
  private readonly recordedEventKeys = new Set<string>();
  private readonly leadMsByTrain = new Map<string, number>();
  private readonly observedStateKeys = new Set<string>();
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
    const events = tick.platforms.flatMap((platform) => this.toNewEvents(tick.source, platform));
    const arrivals = tick.platforms.flatMap((platform) => this.toNewObservedArrivals(platform));
    const predictions = tick.platforms.flatMap((platform) => this.toCrossedPredictions(platform, tick.trackedAt));
    await this.write("events", () => this.repository.insertEvents(events));
    await this.write("predictions", () => this.repository.upsertPredictions(predictions));
    for (const arrival of arrivals) await this.write("arrivals", () => this.repository.updateObservedArrival(arrival, tick.trackedAt));
    await this.sweepUnresolved(tick.trackedAt);
  }

  listAccuracyGroups(range: AccuracyRange): Promise<AccuracyGroup[]> {
    return this.repository.listAccuracyGroups(range);
  }

  private startServiceDate(tick: TrackedTick): void {
    const serviceDate = tick.platforms[0]?.serviceDate ?? this.serviceDate;
    if (serviceDate === this.serviceDate) return;
    this.serviceDate = serviceDate;
    this.recordedEventKeys.clear();
    this.leadMsByTrain.clear();
    this.observedStateKeys.clear();
  }

  // WHY: only the served platform's own events are stored: the stops the
  // tracker also observes there would multiply the writes for no report that reads them.
  private toNewEvents(source: string, platform: TrackedPlatform): SubwayEventDoc[] {
    return platform.events.flatMap((event) => {
      if (event.platformId !== platform.platformId) return [];
      const key = `${source} ${event.trainNo} ${event.platformId} ${event.state}`;
      if (this.recordedEventKeys.has(key)) return [];
      this.recordedEventKeys.add(key);
      const meta = { line: platform.lineCode, trainNo: event.trainNo };
      return [{ at: event.stateChangedAt, meta, stationId: event.platformId, state: event.state, source }];
    });
  }

  private toNewObservedArrivals(platform: TrackedPlatform): ObservedArrival[] {
    return platform.events.flatMap((event) => {
      const observedAt = event.platformId === platform.platformId ? toObservedArrivalAt(event) : null;
      const key = `${platform.platformId} ${event.trainNo} ${event.state}`;
      if (!observedAt || this.observedStateKeys.has(key)) return [];
      this.observedStateKeys.add(key);
      return [{ serviceDate: platform.serviceDate, trainNo: event.trainNo, platformId: platform.platformId, observedAt, observedState: event.state }];
    });
  }

  private toCrossedPredictions(platform: TrackedPlatform, madeAt: Date): SubwayPredictionDoc[] {
    const { serviceDate, platformId } = platform;
    return DIRECTIONS.flatMap((direction) =>
      platform.arrivals.directions[direction].flatMap((train) => {
        const key = `${platformId} ${train.trainNo}`;
        const leadMs = train.arrivalAt.getTime() - madeAt.getTime();
        const horizons = toCrossedHorizons(this.leadMsByTrain.get(key), leadMs);
        this.leadMsByTrain.set(key, leadMs);
        // WHY: a horizon first crossed once the train is seen arrived was crossed by that row (F6): nothing is left to predict.
        if (this.observedStateKeys.has(`${key} arrived`)) return [];
        return horizons.map((horizonMin) => toPredictionDoc({ serviceDate, platformId, direction, horizonMin, train, madeAt }));
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
