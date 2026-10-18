export type TrainMapStatus = "진입" | "접근" | "도착" | "출발" | "이동";

export interface TrainMapTrain {
  trainNo: string;
  stationName: string;
  status: TrainMapStatus;
  destination: string;
}

export interface EmptySpell {
  since: Date;
  lastAt: Date;
}

export interface TrainMapLine {
  trainMapLine: string;
  platformIdByName: ReadonlyMap<string, string>;
}
