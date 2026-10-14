import type { DailyCap } from "../bus-eta.rules";
import type { ShuttleEtaDoc } from "../bus-eta.document";
import type { EtaRun, EtaSequence } from "../bus-eta.types";
import type { LatLng } from "../../../shared/lat-lng.types";

export interface TmapFeature {
  type: "Feature";
  /** QUIRK(tmap): [lng, lat]. */
  geometry: { type: "Point"; coordinates: [number, number] } | { type: "LineString"; coordinates: Array<[number, number]> };
  properties: {
    index?: number;
    pointType?: string;
    time?: number;
    totalTime?: number;
    [k: string]: unknown;
  };
}

export interface TmapPredictionResponse {
  type: string;
  features?: TmapFeature[];
}

export interface BaselineEtaDeps {
  sequences: readonly EtaSequence[];
  upcomingRuns(sequence: EtaSequence, now: Date): Promise<EtaRun[]>;
  fetchOffsets(stops: readonly LatLng[], departAt: Date): Promise<number[]>;
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

export interface TmapCall {
  appKey: string;
  retryDelayMs?: number;
}

export interface FeatureMarks {
  offsets: number[];
  marks: Array<[number, number]>;
  waypoints: number;
  ended: boolean;
}
