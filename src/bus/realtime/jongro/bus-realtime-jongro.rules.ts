import type { BusCacheKey } from "../../cache/bus-cache.document";
import { DWELL_RESET_MINUTES } from "./bus-realtime-jongro.constants";
import type { JongroBusDwell } from "./bus-realtime-jongro.types";

export function toArrivalsKey(code: string): BusCacheKey & `jongro_stations_${string}` {
  return `jongro_stations_${code}`;
}

export function toPositionsKey(code: string): BusCacheKey & `jongro_locations_${string}` {
  return `jongro_locations_${code}`;
}

// QUIRK(topis): "0" is data and "4" no result (overnight); any other code is an upstream error.
export function isUsableHeaderCd(headerCd: string | undefined): boolean {
  return !headerCd || headerCd === "0" || isNoResultHeaderCd(headerCd);
}

export function isNoResultHeaderCd(headerCd: string | undefined): boolean {
  return headerCd === "4";
}

// QUIRK(topis): numbers arrive as strings; anything else is not a number.
export function toTopisInteger(text: string | null | undefined): number | null {
  const trimmed = text?.trim() ?? "";
  return /^-?\d+$/.test(trimmed) ? Number(trimmed) : null;
}

// WHY: TOPIS gives no arrival time, so a bus's time at its last passed station counts from the first tick that
// saw a bus there; the dwell is per station, not per bus.
export function toDwell(firstSeenAt: string | undefined, now: Date): JongroBusDwell {
  const minutesHeld = firstSeenAt ? (now.getTime() - new Date(firstSeenAt).getTime()) / 1000 / 60 : 0;
  if (!firstSeenAt || minutesHeld > DWELL_RESET_MINUTES) return { firstSeenAt: now.toISOString(), dwellSeconds: 0 };
  return { firstSeenAt, dwellSeconds: Math.round((now.getTime() - new Date(firstSeenAt).getTime()) / 1000) };
}
