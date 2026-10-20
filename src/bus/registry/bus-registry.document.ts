export interface RegistryStation {
  /** QUIRK(topis): the stop's station ID, the `stId`, `lastStnId` and `trnstnid` TOPIS answers with. */
  topisId: string;
  arsId: string;
  stationName: string;
  /** WHY: the station's TOPIS ord, which is its index plus one. */
  sequence: number;
}

export interface JongroRouteDocument {
  /** WHY: a route id of JONGRO_ROUTES (`jongro07`). */
  _id: string;
  stations: RegistryStation[];
  turnaroundTopisId: string;
  stationsVersion: string;
  syncedAt: Date;
}
