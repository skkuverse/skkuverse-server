export interface JongroBusSighting {
  stationId: string;
  latitude: string;
  longitude: string;
  carNumber: string;
  turnaroundStationId: string;
}

/** WHY: since when a bus has been at its last passed station (ISO instant), and for how many seconds. */
export interface JongroBusDwell {
  firstSeenAt: string;
  dwellSeconds: number;
}
