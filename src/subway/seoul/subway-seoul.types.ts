import type { ProviderObservations, SubwayProvider, TrainNumbering } from "../subway.types";

export interface SeoulLine {
  subwayId: string;
  lineName: string;
  trainMapLine?: string | undefined;
  trainNumbers: TrainNumbering;
  stationNames: readonly string[];
  platformIdByApiName: ReadonlyMap<string, string>;
  platformIdByTrainMapName: ReadonlyMap<string, string>;
}

export interface SettledObservations extends ProviderObservations {
  failures: readonly unknown[];
}

export interface SettledProvider extends SubwayProvider {
  observe(): Promise<SettledObservations>;
}
