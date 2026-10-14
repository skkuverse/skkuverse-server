import type { SequenceStop } from "../../stops/bus-stops.types";

export type EtaSource = "frozen" | "live" | "predicted";

export interface ServedEstimate {
  offsetsSec: number[];
  source: EtaSource;
  updatedAt: Date;
}

export interface EstimateInputs {
  routeTypes: readonly string[];
  sequences: Readonly<Record<string, readonly SequenceStop[]>>;
  estimates: ReadonlyMap<string, ServedEstimate>;
}
