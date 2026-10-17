export interface JongroBusSighting {
  stationId: string;
  latitude: string;
  longitude: string;
  carNumber: string;
  /** QUIRK(topis): absent when the row names no turnaround stop, which the registry sync reads as no observation. */
  turnaroundStationId?: string;
}

/** WHY: since when a bus has been at its last passed station (ISO instant), and for how many seconds. */
export interface JongroBusDwell {
  firstSeenAt: string;
  dwellSeconds: number;
}
