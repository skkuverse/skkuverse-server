export interface JongroBusSighting {
  stationId: string;
  latitude: string;
  longitude: string;
  carNumber: string;
  /** QUIRK(topis): the full plate, region and number, padded with spaces as TOPIS sends it. */
  plainNo: string;
  /** QUIRK(topis): absent when the row names no turnaround stop, which the registry sync reads as no observation. */
  turnaroundStationId?: string;
  vehicleId: string;
  sectOrd: number;
  /** QUIRK(topis): km into the section toward the next stop, three decimals. */
  sectDist: number;
  /** QUIRK(topis): the section's length in km. */
  fullSectDist: number;
  isAtStop: boolean;
  /** WHY: TOPIS's observation time as an ISO-8601 instant at +09:00. */
  observedAt: string;
  /** QUIRK(topis): seconds to the terminal, 0 only at sectOrd 1; absent when the row carries no number. */
  lastStTm?: number;
}

/** WHY: since when a bus has been at its last passed station (ISO instant), and for how many seconds. */
export interface JongroBusDwell {
  firstSeenAt: string;
  dwellSeconds: number;
}

export type JongroBusTiming = JongroBusDwell & { isStationary: boolean; atStopSince?: string };

/** WHY: the last observation of a vehicle the poller remembers, to tell whether it stood still since. */
export interface JongroVehicleObservation {
  sectOrd: number;
  /** QUIRK(topis): km into the section, three decimals. */
  sectDist: number;
  observedAt: string;
  isStationary: boolean;
  atStopSince?: string;
}
