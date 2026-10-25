import type { I18n } from "../../infra/types";
import type { TransferLine } from "../bus.types";
import type { ScheduleStopCatalog } from "./bus-stops.types";

export interface HsscLineStation {
  /** WHY: one of the dataset's stops, or null at a position the bus passes without stopping. */
  stopId: string | null;
  name: string;
  /** WHY: the English name, served under the Korean one in every language; left out, the line carries only the arrival. */
  subtitle?: string;
  isFirstStation: boolean;
  isLastStation: boolean;
  isRotationStation: boolean;
  /** WHY: riders may only get off here; a revision stored without the key reads it as false. */
  isAlightOnly?: boolean;
  transferLines: TransferLine[];
}

export interface TopisStopOverlay {
  name?: { en?: string; zh?: string };
  subwayStationId?: string;
}

/** WHY: stops grouped for picking a place, never for a page or a pin (ADR 0022, D4); its coords are derived, never stored. */
export interface StopArea {
  id: string;
  name: I18n;
  /** WHY: catalog stop slugs and `seoul-<ARS>` poles; a pole a local stop aliases is that stop. */
  stopIds: string[];
}

export interface BusStopsData extends ScheduleStopCatalog {
  /** WHY: the positions the HSSC realtime view fills, in wire order. */
  hssc: { stations: HsscLineStation[] };
  /** WHY: by ARS number, what a TOPIS pole's stored station cannot say. */
  topis?: Record<string, TopisStopOverlay>;
  stopAreas?: StopArea[];
}

// CONTRACT(scripts): written by scripts/lib/datasets/store.js (npm run data), which validates at push;
// the server still parses it where it reads it.
export interface BusStopsDatasetDoc {
  _id: string;
  revision: number;
  data: BusStopsData;
  updatedAt: Date;
  updatedBy: string;
}

export type StoredBusStops = Pick<BusStopsDatasetDoc, "revision" | "data">;
