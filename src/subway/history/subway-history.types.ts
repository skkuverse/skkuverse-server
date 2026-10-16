import type { ArrivalSource } from "../estimate/subway-estimate.types";
import type { StoredTrainArrival } from "../subway.document";
import type { SubwayDirection, TrainState } from "../subway.types";

export interface ObservedArrival {
  serviceDate: string;
  trainNo: string;
  stationId: string;
  observedAt: Date;
  observedState: TrainState;
}

export interface PredictionMade {
  serviceDate: string;
  stationId: string;
  direction: SubwayDirection;
  horizonMin: number;
  train: StoredTrainArrival;
  madeAt: Date;
}

export interface AccuracyRange {
  from: string;
  to: string;
}

export interface AccuracyGroup {
  stationId: string;
  direction: SubwayDirection;
  horizonMin: number;
  source: ArrivalSource;
  count: number;
  medianErrorSec: number | null;
  medianAbsErrorSec: number | null;
  p90AbsErrorSec: number | null;
  unresolvedCount: number;
}

export interface AccuracyReport extends AccuracyRange {
  groups: AccuracyGroup[];
}
