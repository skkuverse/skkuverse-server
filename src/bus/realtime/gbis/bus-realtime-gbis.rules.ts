import moment from "moment-timezone";
import { KST_TIME_ZONE } from "../../../shared/time-zone.constants";
import { MAX_SEATS_AGE_MS, SERVICE_WINDOW_END_MINUTE, SERVICE_WINDOW_START_MINUTE } from "./bus-realtime-gbis.constants";
import type { GatewayRefusal } from "./bus-realtime-gbis.types";

const NO_RESULT_CODE = 4;
// QUIRK(gbis): data.go.kr's gateway refuses a key's spent daily quota as code 22 LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR
// in its own XML or JSON envelope (data.go.kr 15080648's error table, 2026-10-24); code 23 is the per-second limit.
const QUOTA_EXCEEDED_PATTERN = /LIMITED[ _]NUMBER[ _]OF[ _]SERVICE[ _]REQUESTS[ _]EXCEEDS[ _]ERROR|<returnReasonCode>22</;
// QUIRK(gbis): the gateway's errMsg is often the generic SERVICE ERROR, its returnAuthMsg then naming the cause.
const GENERIC_ERR_MSG = "SERVICE ERROR";

// WHY: the window wraps past midnight, so a minute is inside when it is after the start or before the end.
export function isInServiceWindow(now: Date): boolean {
  const kst = moment.tz(now, KST_TIME_ZONE);
  const minuteOfDay = kst.hours() * 60 + kst.minutes();
  return minuteOfDay >= SERVICE_WINDOW_START_MINUTE || minuteOfDay < SERVICE_WINDOW_END_MINUTE;
}

// WHY: a poller host's clock ahead of the replica's makes a fresh answer look younger than zero, which is fresh.
export function isFreshSeats(checkedAt: Date, now: Date): boolean {
  return now.getTime() - checkedAt.getTime() <= MAX_SEATS_AGE_MS;
}

// QUIRK(gbis): its guide documents remainSeatCnt -1 as no information; the 2026-10-24 capture had 17 to 70.
export function toSeatsLeft(remainSeatCnt: number): number | null {
  return remainSeatCnt >= 0 ? remainSeatCnt : null;
}

// QUIRK(gbis): resultCode 4 ("no result exists" in its guide) is its answer when the route runs no bus.
export function isNoResult(resultCode: number): boolean {
  return resultCode === NO_RESULT_CODE;
}

// WHY: the gateway's envelope comes as XML or JSON, so its three fields are read from the text in either form.
export function toGatewayRefusal(body: unknown): GatewayRefusal | null {
  const text = typeof body === "string" ? body : (JSON.stringify(body) ?? "");
  if (!text.includes("OpenAPI_ServiceResponse")) return null;
  const field = (name: string) => (new RegExp(`<${name}>([^<]*)</${name}>`).exec(text) ?? new RegExp(`"${name}":"([^"]*)"`).exec(text))?.[1];
  const code = field("returnReasonCode");
  if (code === undefined) return null;
  const errMsg = field("errMsg");
  const message = errMsg && errMsg !== GENERIC_ERR_MSG ? errMsg : (field("returnAuthMsg") ?? errMsg ?? "");
  return { code, message };
}

export function isQuotaExceeded(body: unknown): boolean {
  const text = typeof body === "string" ? body : (JSON.stringify(body) ?? "");
  return QUOTA_EXCEEDED_PATTERN.test(text);
}
