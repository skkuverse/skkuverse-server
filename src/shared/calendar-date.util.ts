import moment from "moment-timezone";

const DATE_FORMAT = "YYYY-MM-DD";

/** WHY: strict, so a month or day that is out of range or not zero-padded is no date. */
export function isCalendarDate(value: string): boolean {
  return moment(value, DATE_FORMAT, true).isValid();
}
