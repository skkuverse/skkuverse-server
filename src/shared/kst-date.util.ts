import moment from "moment-timezone";
import { KST_TIME_ZONE } from "./time-zone.constants";

export function toKstDate(instant: Date): string {
  return moment(instant).tz(KST_TIME_ZONE).format("YYYY-MM-DD");
}

export function toKstInstant(ms: number): string {
  return moment(ms).tz(KST_TIME_ZONE).format("YYYY-MM-DDTHH:mm:ssZ");
}
