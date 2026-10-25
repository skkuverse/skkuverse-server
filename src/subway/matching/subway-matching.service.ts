import { Injectable, type OnModuleInit } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import type { LogThrottle } from "../../shared/log-throttle.types";
import { createLogThrottle } from "../../shared/log-throttle.util";
import logger from "../../infra/logger";
import type { TrainEvent } from "../subway.types";
import type { PlatformSchedule } from "../timetable/subway-timetable.types";
import { SubwayTrackingService } from "../tracking/subway-tracking.service";
import { matchRuns } from "./subway-matching.rules";
import type { RunMatch } from "./subway-matching.types";

const UNMATCHED_LOG_INTERVAL_MS = 10 * 60_000;

// WHY: the matches live in memory, like the train histories: one poller process tracks, and a restart rematches
// from the next tick.
@Injectable()
export class SubwayMatchingService implements OnModuleInit {
  private readonly matchesByLine = new Map<string, ReadonlyMap<string, RunMatch>>();
  private readonly unmatchedThrottle: LogThrottle;

  constructor(
    private readonly tracking: SubwayTrackingService,
    private readonly clock: Clock,
  ) {
    this.unmatchedThrottle = createLogThrottle(UNMATCHED_LOG_INTERVAL_MS, () => this.clock.now().getTime());
  }

  onModuleInit(): void {
    this.tracking.setRunMatcher((schedule, events, now) => this.toRunEvents(schedule, events, now));
  }

  private toRunEvents(schedule: PlatformSchedule, events: readonly TrainEvent[], now: Date): TrainEvent[] {
    const lineCode = schedule.platform.line;
    const matched = matchRuns({
      matchesByTrainset: this.matchesByLine.get(lineCode) ?? new Map(),
      events: events.filter((event) => schedule.lineRoutes.up.includes(event.platformId)),
      trains: schedule.trains,
      routes: schedule.lineRoutes,
      now,
    });
    this.matchesByLine.set(lineCode, matched.matchesByTrainset);
    if (matched.unmatched.length > 0) this.logUnmatched(lineCode, matched.unmatched);
    return matched.events;
  }

  private logUnmatched(lineCode: string, unmatched: readonly TrainEvent[]): void {
    const ticket = this.unmatchedThrottle.take(lineCode);
    if (!ticket) return;
    const trainsets = unmatched.map((event) => event.trainNo);
    logger.info(
      { event: "subway.matching.unmatched", lineCode, unmatchedCount: trainsets.length, trainsets, suppressed: ticket.suppressed },
      "Trainsets matched no timetable run; their events are dropped",
    );
  }
}
