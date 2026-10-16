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
