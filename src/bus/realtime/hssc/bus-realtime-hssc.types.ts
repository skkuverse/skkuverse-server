import type moment from "moment-timezone";

export interface HsscBusTiming {
  sequence: number;
  firstSeenAt: moment.Moment;
  dwellSeconds: number;
}
