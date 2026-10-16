import moment from "moment-timezone";
import { KST_TIME_ZONE } from "../../shared/time-zone.constants";

export function toSyncYears(now: Date): number[] {
  const thisYear = moment(now).tz(KST_TIME_ZONE).year();
  return [thisYear, thisYear + 1];
}
