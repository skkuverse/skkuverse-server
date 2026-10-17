import type { SubwayArrivalsDoc } from "../subway.document";
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
  stationId: string;
  stopStationIdsByTrainNo: ReadonlyMap<string, readonly string[]>;
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

export interface TrackedStation {
  stationId: string;
  lineCode: string;
  serviceDate: string;
  events: readonly TrainEvent[];
  arrivals: SubwayArrivalsDoc;
}

export interface TrackedTick {
  source: string;
  trackedAt: Date;
  stations: readonly TrackedStation[];
}

export type TrackedTickListener = (tick: TrackedTick) => Promise<void>;
