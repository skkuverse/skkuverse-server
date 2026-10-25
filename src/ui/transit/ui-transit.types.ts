import type { TransitLayoutRaw } from "./ui-transit.schema";
import type { MiniAppReference, MiniAppRegistry } from "../ui.types";

export interface TransitLayoutReferences {
  busGroupIds: readonly string[];
  stationIds: readonly string[];
  // WHY: a served station with no campus has no section of the tab to sit in, so the layout may leave it out (ADR 0022 D7).
  campuslessStationIds: readonly string[];
  registry: MiniAppRegistry;
}

export interface TransitLayoutIssue {
  path: Array<string | number>;
  message: string;
}

export type TransitLayoutReference = MiniAppReference | { dataset: "busGroups" | "subwayStations"; id: string; path: Array<string | number> };

export interface TransitLayoutRevision {
  revision: number;
  layout: TransitLayoutRaw;
}

export type ServedTransitIds = Pick<TransitLayoutReferences, "busGroupIds" | "stationIds" | "campuslessStationIds">;
