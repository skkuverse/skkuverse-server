import type { ArrivalSource } from "../estimate/subway-estimate.types";
import type { SubwayDirection, TrainState } from "../subway.types";

// WHY: a time-series collection: written by the tracker in the poller process, one document per train, station,
// state and source the first time that source reports it, so the sources' times for one event can be compared.
export interface SubwayEventDoc {
  at: Date;
  meta: { line: string; trainNo: string };
  // WHY: a platform id under its stored name: renaming a field of a 180-day TTL collection needs a migration
  // that buys nothing.
  stationId: string;
  state: TrainState;
  source: string;
}

export type PredictionStatus = "open" | "resolved" | "unresolved";

// WHY: written by the tracker in the poller process, one per service date, train, station and horizon; read
// only by the accuracy report.
export interface SubwayPredictionDoc {
  serviceDate: string;
  trainNo: string;
  // WHY: a platform id under its stored name, as `SubwayEventDoc.stationId`.
  stationId: string;
  horizonMin: number;
  direction: SubwayDirection;
  source: ArrivalSource;
  predictedAt: Date;
  madeAt: Date;
  status: PredictionStatus;
  observedAt: Date | null;
  observedState: TrainState | null;
  resolvedAt: Date | null;
  errorSec: number | null;
}
