import type { CountdownRow, SubwayDirection, TrainState } from "../subway.types";
import type { ScheduledTrain } from "../timetable/subway-timetable.types";
import type { TrainHistory } from "../tracking/subway-tracking.types";

export type ArrivalSource = "live" | "estimated" | "scheduled";

export interface TrainPosition {
  platformId: string;
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
  platformId: string;
  liveArrivalAt: Date;
  estimatedArrivalAt: Date;
  divergenceSec: number;
}

export type CountdownRejectionReason = "spent" | "out_of_range" | "at_station";

export interface CountdownRejection {
  trainNo: string;
  platformId: string;
  reason: CountdownRejectionReason;
  liveArrivalAt: Date;
  estimatedArrivalAt: Date;
}

export interface CountdownVerdict {
  row: CountdownRow;
  reason: CountdownRejectionReason | null;
}

export interface CountdownFindings {
  divergences: CountdownDivergence[];
  rejections: CountdownRejection[];
}

export interface StationArrivals extends CountdownFindings {
  arrivals: TrainArrival[];
}

export interface EstimateInput {
  platformId: string;
  direction: SubwayDirection;
  trains: readonly ScheduledTrain[];
  histories: ReadonlyMap<string, TrainHistory>;
  countdownRows: readonly CountdownRow[];
  isTracked: boolean;
  now: Date;
}
