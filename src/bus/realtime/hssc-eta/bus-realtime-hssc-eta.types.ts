/** WHY: one stop of the loop by the HSSC API's seq: the median seconds at it, then from leaving it to the next stop. */
export interface HsscSegment {
  /** WHY: null at the turnaround, whose layover is never estimated. */
  dwellSeconds: number | null;
  travelSeconds: number;
}

/** WHY: a fresh bus as of its latest stop event, whatever feed reported it. */
export interface HsscBusAnchor {
  /** QUIRK(hssc): the feed's line_no; one line is one vehicle. */
  vehicleId: string;
  /** QUIRK(hssc): the stop's index on the circular route, 0 to 10, the turnaround at 5. */
  seq: number;
  /** WHY: the latest event is a departure (LEFT, LEFT_LAST), not an arrival or a near-stop flag. */
  isDeparted: boolean;
  /** WHY: when the bus left the stop, or when it was first seen at it. */
  since: Date;
  /** WHY: the latest event's own instant, get_date on the HSSC feed. */
  observedAt: Date;
}

interface HsscEtaCommon {
  vehicleId: string;
  /** WHY: positions from the bus forward to the stop round the 11-position loop; a full lap once it left the stop. */
  stopsAway: number;
  observedAt: Date;
}

/** WHY: a bus's status toward one stop; only an en-route bus has an expected arrival (ADR 0018, D2). */
export type HsscEta = (HsscEtaCommon & { status: "enRoute"; arrivesAt: Date }) | (HsscEtaCommon & { status: "arriving" | "waitingToDepart" });
