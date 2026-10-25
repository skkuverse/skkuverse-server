import type { SubwayDirection, TrainState } from "./subway.types";

export interface StoredTrainArrival {
  trainNo: string;
  destination: string;
  express: boolean;
  arrivalAt: Date;
  source: "live" | "estimated" | "scheduled";
  isFirstTrain: boolean;
  // WHY: a platform id under its stored name, as the history's.
  position: { stationId: string; state: TrainState } | null;
  // WHY: optional, as an api replica deploys before the poller and reads documents written without them (ADR 0012, D3).
  isLastRun?: boolean;
  scheduledArrivalAt?: Date | null;
  scheduledDepartureAt?: Date | null;
  passedPlatformIds?: readonly string[];
}

// WHY: written by the tracker in the poller process and read by the api replicas, one document per platform.
export interface SubwayArrivalsDoc {
  _id: string;
  generatedAt: Date;
  serviceDate: string;
  directions: Readonly<Record<SubwayDirection, readonly StoredTrainArrival[]>>;
}
