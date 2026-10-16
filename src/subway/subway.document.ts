import type { SubwayDirection, TrainState } from "./subway.types";

export interface StoredTrainArrival {
  trainNo: string;
  destination: string;
  express: boolean;
  arrivalAt: Date;
  source: "live" | "estimated" | "scheduled";
  position: { stationId: string; state: TrainState } | null;
}

// WHY: written by the tracker in the poller process and read by the api replicas, one document per station.
export interface SubwayArrivalsDoc {
  _id: string;
  generatedAt: Date;
  serviceDate: string;
  directions: Readonly<Record<SubwayDirection, readonly StoredTrainArrival[]>>;
}
