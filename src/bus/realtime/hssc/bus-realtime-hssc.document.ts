/** WHY: `hssc_feed_events`, one document per distinct HSSC stop event, appended by the HSSC poller as training data. */
export interface HsscFeedEventDoc {
  lineNo: string;
  /** QUIRK(hssc): the stop's index on the circular route, as the API numbers it (0-10). */
  seq: number;
  stopNo: string;
  stopName: string;
  /** QUIRK(hssc): "ENTERED", "LEFT", "LEFT_LAST" or "EMERGENCY", stored as received. */
  inout: string;
  getDate: Date;
  rawGetDate: string;
  polledAt: Date;
}
