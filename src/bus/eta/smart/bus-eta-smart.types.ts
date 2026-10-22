import type { SequenceStop } from "../../stops/bus-stops.types";
import type { ShuttleEtaDoc } from "../bus-eta.document";

export type EtaSource = "frozen" | "live" | "predicted";

export interface ServedEstimate {
  offsetsSec: number[];
  source: EtaSource;
  updatedAt: Date;
}

export type EstimatePick = (docs: readonly ShuttleEtaDoc[], now: Date) => Map<string, ServedEstimate>;

export interface EstimateInputs {
  routeTypes: readonly string[];
  sequences: Readonly<Record<string, readonly SequenceStop[]>>;
  estimates: ReadonlyMap<string, ServedEstimate>;
}
