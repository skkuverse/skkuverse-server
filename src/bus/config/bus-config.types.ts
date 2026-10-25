import type { z } from "zod";
import type { SupportedLang } from "../../infra/types";
import type { JongroRouteAttributes, StopAliases, TransferLine } from "../bus.types";
import type { JongroStation, RegistryRoute } from "../registry/bus-registry.types";
import type { HsscLineStation } from "../stops/bus-stops.document";
import type { ResolvedStops } from "../stops/bus-stops.types";
import type { busGroupVisibility } from "./bus-config.schema";
import type { BusGroup } from "./bus-config.wire";

export type BusGroupVisibility = z.output<typeof busGroupVisibility>;

export type LineDirection = Extract<BusGroup["screen"], { directions: unknown }>["directions"][number];

export type StationDirection = Pick<LineDirection, "id" | "label">;

/** WHY: a station by its index and the stations version that placed it, null on the HSSC line, which has none. */
export type PlacedStation = { stationIndex: number; stationsVersion: string | null };

/** WHY: a realtime line's directions in line order, and each station's direction id by index, null where none joins. */
export interface LineDirections {
  directions: LineDirection[];
  directionIds: Array<string | null>;
}

/**
 * WHY: a Jongro station with its transfer lines, joined by ARS number from the route's stored attributes, and the stop
 * its pole is, null for a virtual stop.
 */
export type AttributedJongroStation = JongroStation & { transferLines: TransferLine[]; stopId?: string | null };

export type AnyStation = HsscLineStation | AttributedJongroStation;

export interface AttributedJongroRoute {
  route: RegistryRoute;
  attributes: JongroRouteAttributes;
  directions: LineDirections;
}

export interface MappedStation {
  index: number;
  name: string;
  subtitle: string | null;
  stationNumber: string | null;
  directionId: string | null;
  isFirstStation: boolean;
  isLastStation: boolean;
  isRotationStation: boolean;
  isPassThrough: boolean;
  isAlightOnly: boolean;
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
  /** WHY: the bus-stops aliases, which name the stop of a Jongno station whose pole a local stop is. */
  aliases: StopAliases;
  jongroRoutes: ReadonlyArray<AttributedJongroRoute>;
  webviewOrigin: string;
}
