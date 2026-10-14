import type { DailyCap } from "../bus-eta.rules";
import type { ShuttleEtaDoc } from "../bus-eta.document";
import type { EtaRun, EtaSequence } from "../bus-eta.types";
import type { LatLng } from "../../../shared/lat-lng.types";

export interface NaverDirectionsGuide {
  pointIndex: number;
  type: number;
  instructions?: string;
  distance: number;
  duration: number;
}

export interface NaverDirectionsResponse {
  code: number;
  message: string;
  route?: {
    traoptimal?: Array<{
      summary: { duration: number; distance: number; [k: string]: unknown };
      /** QUIRK(naver): [lng, lat]. */
      path: Array<[number, number]>;
      guide: NaverDirectionsGuide[];
      [k: string]: unknown;
    }>;
    [k: string]: unknown;
  };
}

export interface NaverCredentials {
  keyId: string;
  key: string;
}

export interface LiveEtaDeps {
  sequences: readonly EtaSequence[];
  runsOn(sequence: EtaSequence, date: string): Promise<EtaRun[]>;
  fetchOffsets(stops: readonly LatLng[]): Promise<number[]>;
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

export interface GuideMarks {
  offsetsMs: number[];
  pointIndexes: number[];
  waypoints: number;
  goals: number;
}
