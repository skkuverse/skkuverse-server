import type moment from "moment-timezone";

export interface HsscBusTiming {
  sequence: number;
  eventAt: moment.Moment;
  dwellSeconds: number;
}
