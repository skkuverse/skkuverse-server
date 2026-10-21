import type { DailyCap } from "../../../shared/daily-cap.util";
import type { ShuttleEtaDoc } from "../bus-eta.document";
import type { EtaRun, EtaSequence } from "../bus-eta.types";
import type { BusEtaForecastService } from "../forecast/bus-eta-forecast.service";

export type BaselineForecast = Pick<BusEtaForecastService, "fetchOffsets" | "reusableFixedByRun">;

export interface BaselineEtaDeps {
  sequences(): Promise<readonly EtaSequence[]>;
  upcomingRuns(sequence: EtaSequence, now: Date): Promise<EtaRun[]>;
  forecast: BaselineForecast;
  readEtas(serviceIds: string[], dates: string[]): Promise<ShuttleEtaDoc[]>;
  writeEtas(docs: ShuttleEtaDoc[]): Promise<unknown>;
  cap: DailyCap;
  sleep(ms: number): Promise<void>;
}

export interface BaselineTickResult {
  calls: number;
  written: number;
}

export interface SequencedRun {
  sequence: EtaSequence;
  run: EtaRun;
}

