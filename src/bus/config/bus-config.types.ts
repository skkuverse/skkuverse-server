import type { z } from "zod";
import type { SupportedLang } from "../../infra/types";
import type { JongroRouteAttributes, TransferLine } from "../bus.types";
import type { JongroStation, RegistryRoute } from "../registry/bus-registry.types";
import type { HsscLineStation } from "../stops/bus-stops.document";
import type { ResolvedStops } from "../stops/bus-stops.types";
import type { busGroupVisibility } from "./bus-config.schema";

export type BusGroupVisibility = z.output<typeof busGroupVisibility>;

/**
 * WHY: a Jongro station with its transfer lines, joined by ARS number from the route's stored attributes, and the stop
 * its pole is, null for a virtual stop.
 */
export type AttributedJongroStation = JongroStation & { transferLines: TransferLine[]; stopId?: string | null };

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
  isPassThrough: boolean;
  transferLines: AnyStation["transferLines"];
  stopId?: string;
}

export interface GroupStops {
  campus: ResolvedStops;
  commute: ResolvedStops;
}

export interface BusGroupSources {
  lang: SupportedLang;
  stops: GroupStops;
  hsscStations: readonly HsscLineStation[];
  /** WHY: the bus-stops aliases, by ARS number, which name the stop of a Jongno station whose pole a local stop is. */
  stopIdByArsId: ReadonlyMap<string, string>;
  jongroRoutes: ReadonlyArray<AttributedJongroRoute>;
  webviewOrigin: string;
}
