import moment from "moment-timezone";
import { KST_TIME_ZONE } from "../../../shared/time-zone.constants";

const REFRESH_HOUR = 4;

/** WHY: the latest 04:00 KST at or before `now`: baselines fetched earlier are refreshed. */
export function refreshCutoff(now: Date): Date {
  const local = moment(now).tz(KST_TIME_ZONE);
  const cutoff = local.clone().startOf("day").hour(REFRESH_HOUR);
  if (cutoff.isAfter(local)) cutoff.subtract(1, "day");
  return cutoff.toDate();
}
