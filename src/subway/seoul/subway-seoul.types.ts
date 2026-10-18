import type { CountdownPlatform } from "../seoul-api/subway-seoul-api.types";
import type { ProviderObservations, SubwayProvider, TrainNumbering } from "../subway.types";

export interface SeoulLine {
  subwayId: string;
  lineName: string;
  trainMapLine?: string | undefined;
  trainNumbers: TrainNumbering;
  platformIdByApiName: ReadonlyMap<string, string>;
  platformIdByTrainMapName: ReadonlyMap<string, string>;
}

export interface SeoulStation {
  seoulName: string;
  platformBySubwayId: ReadonlyMap<string, CountdownPlatform>;
}

export interface SettledObservations extends ProviderObservations {
  failures: readonly unknown[];
}

export interface SettledProvider extends SubwayProvider {
  observe(): Promise<SettledObservations>;
}
