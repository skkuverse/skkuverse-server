import type { z } from "zod";
import type { SupportedLang } from "../../infra/types";
import type { JongroRouteAttributes, TransferLine } from "../bus.types";
import type { JongroStation, RegistryRoute } from "../registry/bus-registry.types";
import type { HsscLineStation } from "../stops/bus-stops.document";
import type { ResolvedStops } from "../stops/bus-stops.types";
import type { busGroupVisibility } from "./bus-config.schema";

export type BusGroupVisibility = z.output<typeof busGroupVisibility>;

/** WHY: a Jongro station with its transfer lines, joined by ARS number from the route's stored attributes. */
export type AttributedJongroStation = JongroStation & { transferLines: TransferLine[] };

export type AnyStation = HsscLineStation | AttributedJongroStation;

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
  hsscStations: readonly HsscLineStation[];
  jongroRoutes: ReadonlyArray<AttributedJongroRoute>;
  webviewOrigin: string;
}
