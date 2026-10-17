import type { SubwayDirection, TrainEvent } from "../subway.types";
import type { LineRoutes, ScheduledTrain } from "../timetable/subway-timetable.types";

export interface RunMatch {
  runNo: string;
  direction: SubwayDirection;
  platformId: string;
  lastSeenAt: Date;
}

export interface Sighting {
  event: TrainEvent;
  direction: SubwayDirection | undefined;
}

export interface MatchingTick {
  matchesByTrainset: ReadonlyMap<string, RunMatch>;
  events: readonly TrainEvent[];
  trains: readonly ScheduledTrain[];
  routes: LineRoutes;
  now: Date;
}

export interface MatchedRuns {
  matchesByTrainset: Map<string, RunMatch>;
  events: TrainEvent[];
  unmatched: TrainEvent[];
}
