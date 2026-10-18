import type { Position } from "../../shared/geojson.types";

export interface RoutePathStation {
  /** QUIRK(topis): the stop's station ID, `station` in getStaionByRoute and `stId` in the arrival rows. */
  topisId: string;
  arsId: string;
  stationName: string;
  /** WHY: the station's TOPIS `seq`, from one. */
  sequence: number;
  lng: number;
  lat: number;
  /** QUIRK(topis): `transYn` "Y", the stop where the route turns back. */
  isTurnaround: boolean;
}

export interface JongroRoutePathDocument {
  /** WHY: the route id of jongro-routes.json (`jongro07`). */
  _id: string;
  busRouteId: string;
  /** QUIRK(topis): getRoutePath's points in `no` order, as [lng, lat]; a loop does not end on its first point. */
  path: Position[];
  stations: RoutePathStation[];
  pathVersion: string;
  /** WHY: when the stored content was written; an unchanged sync writes nothing (add-jongro-route-lines D3). */
  syncedAt: Date;
}
