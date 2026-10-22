import type moment from "moment-timezone";

export interface HsscBusTiming {
  sequence: number;
  firstSeenAt: moment.Moment;
  dwellSeconds: number;
}

export interface HsscFeedEventTiming {
  seq: number;
  getDate: Date;
}

/** WHY: a cached bus as its latest stop event, which the HSSC ETA engine anchors (ADR 0018, D1). */
export interface HsscStopEvent {
  /** QUIRK(hssc): the feed's line_no; one line is one vehicle. */
  vehicleId: string;
  seq: number;
  inout: string;
  eventAt: Date;
  /** WHY: the poller's first sighting of the bus at this stop. */
  firstSeenAt: Date;
}

export interface HsscStopEvents {
  events: HsscStopEvent[];
  /** WHY: when the poller last wrote the buses; null when bus_cache holds none. */
  checkedAt: Date | null;
}
