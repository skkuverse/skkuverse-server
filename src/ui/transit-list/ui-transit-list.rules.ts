import moment from "moment-timezone";
import type { BusGroupVisibility } from "./ui-transit-list.types";

const KST = "Asia/Seoul";

// WHY: a date range covers its first and last day whole, in KST, whatever zone the host runs in;
// `fromTime` (KST) opens it later on the first day.
export function isBusGroupVisible(visibility: BusGroupVisibility, now: Date): boolean {
  if (visibility.type === "always") return true;
  const from = visibility.fromTime
    ? moment.tz(`${visibility.from} ${visibility.fromTime}`, "YYYY-MM-DD HH:mm", true, KST)
    : moment.tz(visibility.from, "YYYY-MM-DD", KST).startOf("day");
  const until = moment.tz(visibility.until, "YYYY-MM-DD", KST).endOf("day");
  return moment(now).isBetween(from, until, null, "[]");
}
