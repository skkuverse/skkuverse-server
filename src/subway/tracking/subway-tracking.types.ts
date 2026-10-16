import type { CountdownRow, SubwayDirection, TrainEvent, TrainState } from "../subway.types";
import type { LineRoutes } from "../timetable/subway-timetable.types";

export interface TrainProgress {
  stationId: string;
  state: TrainState;
  at: Date;
  ordinal: number;
}

export interface TrainHistory {
  trainNo: string;
  direction: SubwayDirection;
  destination: string;
  latest: TrainProgress;
  lastSeenAt: Date;
}

export interface TrackingTick {
  histories: ReadonlyMap<string, TrainHistory>;
  responseEvents: readonly (readonly TrainEvent[])[];
  routes: LineRoutes;
  directionByDestination: ReadonlyMap<string, SubwayDirection>;
  now: Date;
}

export interface SourceCountdownRows {
  observedAt: Date;
  rows: readonly CountdownRow[];
}

export interface StationObservations {
  histories: ReadonlyMap<string, TrainHistory>;
  countdownRows: readonly CountdownRow[];
}
