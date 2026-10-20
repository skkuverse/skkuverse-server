import type { z } from "zod";
import type { SupportedLang } from "../../infra/types";
import type { JongroRouteAttributes, TransferLine } from "../bus.types";
import type { JongroStation, RegistryRoute } from "../registry/bus-registry.types";
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

/** WHY: a Jongro station with its transfer lines, joined by ARS number from the route's stored attributes. */
export type AttributedJongroStation = JongroStation & { transferLines: TransferLine[] };

export type AnyStation = HsscStation | AttributedJongroStation;

export interface AttributedJongroRoute {
  route: RegistryRoute;
  attributes: JongroRouteAttributes;
}

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
  jongroRoutes: ReadonlyArray<AttributedJongroRoute>;
  webviewOrigin: string;
}
