import type { LatLng } from "../../shared/lat-lng.types";
import type { NetworkIssue } from "../subway.types";

export interface SubwayStationCoordsData {
  stations: Record<string, LatLng>;
}

export type StationCoordsIssue = NetworkIssue;

/** WHY: one revision of the stored coords; `coordsOf` answers none for a station the revision lacks or the code does not serve. */
export interface StationCoordsSnapshot {
  revision: number;
  coordsOf(stationId: string): LatLng | undefined;
}
