import type { DailyCap } from "../../../shared/daily-cap.util";
import type { ShuttleEtaDoc } from "../bus-eta.document";
import type { EtaRun, EtaSequence } from "../bus-eta.types";
import type { SequenceStrategy } from "../lane/bus-eta-lane.types";
import type { BusEtaTravelService } from "../travel/bus-eta-travel.service";

export type LiveTravel = Pick<BusEtaTravelService, "strategyOfRun" | "corridor" | "fetchOffsets" | "fetchCorridorRoute" | "legTime" | "prime">;

export interface LiveEtaDeps {
  sequences(): Promise<readonly EtaSequence[]>;
  runsOn(sequence: EtaSequence, date: string): Promise<EtaRun[]>;
  travel: LiveTravel;
  readEtas(serviceIds: string[], dates: string[]): Promise<ShuttleEtaDoc[]>;
  writeEtas(docs: ShuttleEtaDoc[]): Promise<unknown>;
  cap: DailyCap;
}

export interface LiveTickResult {
  calls: number;
  written: number;
}

export interface LiveWork {
  fix: EtaRun[];
  inWindow: EtaRun[];
  fallback: ShuttleEtaDoc[];
  stale: boolean;
}

/** WHY: where a run stands in its live window: not yet in it or already fixed, before departure, in the fix grace, past it. */
export type RunPhase = "idle" | "window" | "departed" | "late";

/** WHY: a sequence's due runs that one travel model serves, with one directions call for them all. */
export interface ModelGroup {
  strategy: SequenceStrategy;
  fix: EtaRun[];
  inWindow: EtaRun[];
}

/** WHY: the upstream a held tick failure belongs to (`schedule`: the day's runs, `corridor`: the stored corridor); each stays failing until a request to it succeeds. */
export type LiveUpstream = "naver" | "topis" | "schedule" | "corridor";
