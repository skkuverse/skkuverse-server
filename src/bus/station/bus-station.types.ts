import type { HsscBusDoc } from "../cache/bus-cache.document";

/** WHY: a station of the HSSC line as the station ETA counts it, by the HSSC API's own numbering. */
export interface HsscEtaStation {
  sequence: number;
  stationName: string;
}

export type HsscBusAtStop = Pick<HsscBusDoc, "sequence" | "estimatedTime"> & Partial<HsscBusDoc>;
