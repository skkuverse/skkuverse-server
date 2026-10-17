import type { ProviderObservations, SubwayProvider } from "../subway.types";

export interface SeoulLine {
  subwayId: string;
  lineName: string;
  trainMapLine: string;
  stationNames: readonly string[];
  stationIdByName: ReadonlyMap<string, string>;
}

export interface SettledObservations extends ProviderObservations {
  failures: readonly unknown[];
}

export interface SettledProvider extends SubwayProvider {
  observe(): Promise<SettledObservations>;
}
