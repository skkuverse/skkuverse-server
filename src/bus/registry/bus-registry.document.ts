export interface RegistryStation {
  /** QUIRK(topis): the stop's station ID, the `stId`, `lastStnId` and `trnstnid` TOPIS answers with. */
  topisId: string;
  arsId: string;
  stationName: string;
  /** WHY: the station's TOPIS ord, which is its index plus one. */
  sequence: number;
}

/** WHY: one stop's first and last run as TOPIS last stated them, kept through a night whose polls answer no rows. */
export interface StationServiceHours {
  /** WHY: the station's TOPIS ord, as the arrival rows number it. */
  sequence: number;
  /** QUIRK(topis): at +09:00, dated by TOPIS's own service day, so only the time of day is read. */
  firstTm: string;
  lastTm: string;
}

export interface JongroRouteDocument {
  /** WHY: a route id of JONGRO_ROUTES (`jongro07`). */
  _id: string;
  stations: RegistryStation[];
  turnaroundTopisId: string;
  stationsVersion: string;
  syncedAt: Date;
  /** WHY: absent on a route the poller has not stated hours for since this field was added. */
  serviceHours?: StationServiceHours[];
}
