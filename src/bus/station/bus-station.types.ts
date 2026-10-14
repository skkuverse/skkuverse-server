import type { HsscBusDoc } from "../cache/bus-cache.document";

export interface HsscStation {
  sequence: number;
  stationName: string;
  stationNumber: string | null;
  eta: string;
  isFirstStation: boolean;
  isLastStation: boolean;
  isRotationStation: boolean;
  busType: string;
}

export type HsscBusAtStop = Pick<HsscBusDoc, "sequence" | "estimatedTime"> & Partial<HsscBusDoc>;
