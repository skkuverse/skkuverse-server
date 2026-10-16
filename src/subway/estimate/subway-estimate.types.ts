import type { CountdownRow, SubwayDirection, TrainState } from "../subway.types";
import type { ScheduledTrain } from "../timetable/subway-timetable.types";
import type { TrainHistory } from "../tracking/subway-tracking.types";

export type ArrivalSource = "live" | "estimated" | "scheduled";

export interface TrainPosition {
  stationId: string;
  state: TrainState;
}

export interface TrainArrival {
  trainNo: string;
  direction: SubwayDirection;
  destination: string;
  express: boolean;
  arrivalAt: Date;
  source: ArrivalSource;
  position: TrainPosition | null;
}

export interface CountdownDivergence {
  trainNo: string;
  stationId: string;
  liveArrivalAt: Date;
  estimatedArrivalAt: Date;
  divergenceSec: number;
}

export interface StationArrivals {
  arrivals: TrainArrival[];
  divergences: CountdownDivergence[];
}

export interface EstimateInput {
  stationId: string;
  direction: SubwayDirection;
  trains: readonly ScheduledTrain[];
  histories: ReadonlyMap<string, TrainHistory>;
  countdownRows: readonly CountdownRow[];
  now: Date;
}
