import type { LaneDirection } from "../lane/bus-eta-lane.types";

/** WHY: `bus_lane_spans`, one document per counted probe span, written only by the probe service for a time-of-day profile. */
export interface BusLaneSpanDoc {
  /** WHY: `${routeId}|${vehId}|${fromAt}|${toAt}` as ISO instants, so a span recorded twice is stored once. */
  _id: string;
  routeId: string;
  vehId: string;
  direction: LaneDirection;
  /** WHY: corridor meters where the bus was at `fromAt` and at `toAt`, in its direction of travel. */
  fromAlongM: number;
  toAlongM: number;
  fromAt: Date;
  toAt: Date;
  speedKmh: number;
  expiresAt: Date;
}
