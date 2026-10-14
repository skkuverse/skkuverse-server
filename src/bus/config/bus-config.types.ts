import type { z } from "zod";
import type { SupportedLang } from "../../infra/types";
import type { JongroRoute, JongroStation, TransferLine } from "../bus.types";
import type { ResolvedStops } from "../stops/bus-stops.types";
import type { busGroupVisibility } from "./bus-config.schema";

export type BusGroupVisibility = z.output<typeof busGroupVisibility>;

export interface HsscStation {
  sequence: number;
  stationName: string;
  /** WHY: the English name, shown under the Korean one. */
  subtitle: string;
  stationNumber: string | null;
  isFirstStation: boolean;
  isLastStation: boolean;
  isRotationStation: boolean;
  busType: string;
  transferLines: TransferLine[];
}

export type AnyStation = HsscStation | JongroStation;

export interface MappedStation {
  index: number;
  name: string;
  subtitle: string | null;
  stationNumber: string | null;
  isFirstStation: boolean;
  isLastStation: boolean;
  isRotationStation: boolean;
  transferLines: AnyStation["transferLines"];
}

export interface GroupStops {
  campus: ResolvedStops;
  commute: ResolvedStops;
}

export interface BusGroupSources {
  lang: SupportedLang;
  stops: GroupStops;
  jongroRoutes: ReadonlyArray<JongroRoute>;
  webviewOrigin: string;
}
