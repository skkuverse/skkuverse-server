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
