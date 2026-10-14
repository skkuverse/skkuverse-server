import moment from "moment-timezone";
import type { BusGroupVisibility } from "../../bus/config/bus-config.types";

const KST = "Asia/Seoul";

const FIRST_DAY_OPENING_FORMAT = "YYYY-MM-DD HH:mm";

// QUIRK(moment): a strict parse still takes "24:00" as the next midnight, so the parse is compared back to the input.
// WHY: bus parses fromTime at import (bus-config.constants.ts), which is the gate; this throw is the second line.
function toFirstDayOpening(from: string, fromTime: string): moment.Moment {
  const written = `${from} ${fromTime}`;
  const opensAt = moment.tz(written, FIRST_DAY_OPENING_FORMAT, true, KST);
  if (opensAt.isValid() && opensAt.format(FIRST_DAY_OPENING_FORMAT) === written) return opensAt;
  throw new Error(`bus group fromTime "${fromTime}" on ${from} is not a KST time from 00:00 to 23:59`);
}

// WHY: a date range covers its first and last day whole, in KST, whatever zone the host runs in;
// `fromTime` (KST) opens it later on the first day.
export function isBusGroupVisible(visibility: BusGroupVisibility, now: Date): boolean {
  if (visibility.type === "always") return true;
  const from = visibility.fromTime
    ? toFirstDayOpening(visibility.from, visibility.fromTime)
    : moment.tz(visibility.from, "YYYY-MM-DD", KST).startOf("day");
  const until = moment.tz(visibility.until, "YYYY-MM-DD", KST).endOf("day");
  return moment(now).isBetween(from, until, null, "[]");
}
